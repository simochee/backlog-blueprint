import { type Diagnostic } from "../diagnostic";
import {
  CUSTOM_FIELD_TYPE_IDS,
  INITIAL_VALUE_TYPE_IDS,
  ISSUE_TYPE_COLORS,
  SETTINGS_KEYS,
  STATUS_COLORS,
  TEXT_FORMATTING_RULES,
  typeSpecificCustomFieldKeys,
  type Category,
  type CustomField,
  type CustomFieldType,
  type InitialValueType,
  type IssueType,
  type ManifestInput,
  normalizeManifest,
  type Milestone,
  type Settings,
  type Status,
  type TypeSpecificCustomFieldKey,
  type Webhook,
} from "../manifest";
import { type ResourceSnapshots } from "../plan";
import { type AccessSnapshot } from "../resources/access";
import { type CustomFieldsSnapshot, type ExistingCustomField } from "../resources/custom-fields";
import { type ExistingIssueType } from "../resources/issue-types";
import { type ExistingMilestone } from "../resources/milestones";
import { type ProjectSettingsSnapshot } from "../resources/project";
import { isDefaultStatus, type ExistingStatus } from "../resources/statuses";
import { type WebhooksSnapshot } from "../resources/webhooks";
import { envReferencePattern } from "../validation/expand-stage";
import { hasError } from "../validation/gate";
import { validateSchema } from "../validation/schema-stage";
import { validateStaticSemantics } from "../validation/semantic-stage";
import { type SourceMap } from "../validation/source-map";
import { type Value } from "../value";
import {
  ascendingEventIds,
  WEBHOOK_EVENTS,
  type WebhookEvent,
  type WebhookEventName,
} from "../webhook-events";
import {
  cannotBeWritten,
  duplicateName,
  listWithoutItems,
  nameHoldsBrace,
  nonBooleanSetting,
  projectDoesNotExist,
  unknownApplicableIssueType,
  unknownColor,
  unknownCustomFieldType,
  unknownInitialValueType,
  unknownTextFormattingRule,
  webhookWithoutEvents,
} from "./diagnostics";

export type WebhookVariable = { variable: string; webhook: string };

export type ToManifestResult = {
  diagnostics: Diagnostic[];
  /** 診断にエラーが1件でもあれば undefined（EX-9 / EX-17） */
  manifest?: ManifestInput;
  /** EX-4 の案内に使う。diagnostics がエラーなら空配列 */
  webhookVariables: WebhookVariable[];
};

type Report = (diagnostic: Diagnostic) => void;

type Named = { name: string };

const path = (...segments: (string | number)[]): string => segments.join("/");

/**
 * E-3 の逆写像（EX-5）。`${` を無条件に置き換えない。S2 が展開するのは
 * `envReferencePattern` に一致する完全な参照だけなので、`${foo` のように閉じない値まで
 * 置き換えると、読み戻しても `$` が剥がれず往復が壊れる。置換後の文字列を関数で返すのは、
 * 置換文字列では `$$` が `$` 1文字を表すエスケープで、`$` を足したつもりが消えるため。
 */
const escaped = (value: string): string =>
  value.replace(envReferencePattern(), (match) => `$${match}`);

const asDate = (value: string): string => value.slice(0, 10);

const CUSTOM_FIELD_TYPES_BY_ID = new Map<number, CustomFieldType>(
  Object.entries(CUSTOM_FIELD_TYPE_IDS).map(([type, id]) => [id, type as CustomFieldType]),
);

const INITIAL_VALUE_TYPES_BY_ID = new Map<number, InitialValueType>(
  Object.entries(INITIAL_VALUE_TYPE_IDS).map(([type, id]) => [id, type as InitialValueType]),
);

const WEBHOOK_EVENT_NAMES_BY_ID = new Map<number, WebhookEventName>(
  WEBHOOK_EVENTS.map(({ id, name }) => [id, name]),
);

const holds = (allowed: readonly string[], value: string): boolean => allowed.includes(value);

/**
 * パレット外の色も値としては載せる。EX-9c を同じ実行で出し、EX-17 がマニフェストごと
 * 捨てるので、ここで別の色に差し替えると実状と違うものを書いたことになる。
 */
const issueTypeColor = (color: string): IssueType["color"] => color as IssueType["color"];

const statusColor = (color: string): Status["color"] => color as Status["color"];

const reportName = (report: Report, section: string, noun: string, items: Named[]): void => {
  for (const [index, { name }] of items.entries()) {
    const at = path(section, index, "name");

    if (items.findIndex((other) => other.name === name) < index) {
      report(duplicateName(at, noun, name));
    }

    if (name.includes("}")) {
      report(nameHoldsBrace(at, noun, name));
    }
  }
};

type ExportableProject = {
  name: string;
  settings: ProjectSettingsSnapshot;
  issueTypes: ExistingIssueType[];
  statuses: ExistingStatus[];
};

/**
 * `source: "defaults"` を空の配列として扱わない。`read()` がそれを返すのは
 * プロジェクトが未作成のときだけで、その場合に利用者へ言うべきことは EX-3 である。
 */
const exportableProject = ({
  project,
  issueTypes,
  statuses,
}: ResourceSnapshots): ExportableProject | undefined =>
  project.exists && issueTypes.source === "project" && statuses.source === "project"
    ? {
        name: project.name,
        settings: project.settings,
        issueTypes: issueTypes.issueTypes,
        statuses: statuses.statuses,
      }
    : undefined;

type TextFormattingRule = (typeof TEXT_FORMATTING_RULES)[number];

const isTextFormattingRule = (value: Value): value is TextFormattingRule =>
  typeof value === "string" && holds(TEXT_FORMATTING_RULES, value);

const toSettings = (snapshot: ProjectSettingsSnapshot, report: Report): Settings => {
  const settings: Settings = {};

  for (const key of SETTINGS_KEYS) {
    const value = snapshot[key];

    if (value === undefined) {
      continue;
    }

    if (key === "textFormattingRule") {
      if (isTextFormattingRule(value)) {
        settings.textFormattingRule = value;
      } else {
        report(unknownTextFormattingRule(value));
      }

      continue;
    }

    if (typeof value === "boolean") {
      settings[key] = value;
    } else {
      report(nonBooleanSetting(key, value));
    }
  }

  return settings;
};

const toIssueTypes = (existing: ExistingIssueType[], report: Report): IssueType[] => {
  reportName(report, "issueTypes", "issue type", existing);

  return existing.map(({ name, color, templateSummary, templateDescription }, index) => {
    if (!holds(ISSUE_TYPE_COLORS, color)) {
      report(unknownColor(path("issueTypes", index, "color"), "issue type", name, color));
    }

    return {
      name: escaped(name),
      color: issueTypeColor(color),
      ...(templateSummary === undefined ? {} : { templateSummary: escaped(templateSummary) }),
      ...(templateDescription === undefined
        ? {}
        : { templateDescription: escaped(templateDescription) }),
    };
  });
};

const toStatuses = (existing: ExistingStatus[], report: Report): Status[] => {
  reportName(report, "statuses", "status", existing);

  return existing.map((status, index) => {
    const { name, color } = status;

    if (isDefaultStatus(status)) {
      return { name: escaped(name) };
    }

    if (!holds(STATUS_COLORS, color)) {
      report(unknownColor(path("statuses", index, "color"), "status", name, color));
    }

    return { name: escaped(name), color: statusColor(color) };
  });
};

const toCategories = (existing: Named[], report: Report): Category[] => {
  reportName(report, "categories", "category", existing);

  return existing.map(({ name }) => ({ name: escaped(name) }));
};

const toMilestones = (existing: ExistingMilestone[], report: Report): Milestone[] => {
  reportName(report, "milestones", "milestone", existing);

  return existing.map(({ name, description, startDate, releaseDueDate }) => ({
    name: escaped(name),
    ...(description === undefined ? {} : { description: escaped(description) }),
    ...(startDate === undefined ? {} : { startDate: asDate(startDate) }),
    ...(releaseDueDate === undefined ? {} : { releaseDueDate: asDate(releaseDueDate) }),
  }));
};

type TypeSpecificValues = Partial<Pick<CustomField, TypeSpecificCustomFieldKey>>;

const asRange = (value: number | string | undefined): number | string | undefined =>
  typeof value === "string" ? asDate(value) : value;

const typeSpecificValues = (
  existing: ExistingCustomField,
  initialValueType: InitialValueType | undefined,
): TypeSpecificValues => ({
  min: asRange(existing.min),
  max: asRange(existing.max),
  initialValue: existing.initialValue,
  unit: existing.unit === undefined ? undefined : escaped(existing.unit),
  initialDate: existing.initialDate === undefined ? undefined : asDate(existing.initialDate),
  initialValueType,
  initialShift: existing.initialShift,
  items: existing.items?.map(escaped),
  allowInput: existing.allowInput,
  allowAddItem: existing.allowAddItem,
});

const projected = (
  values: TypeSpecificValues,
  keys: TypeSpecificCustomFieldKey[],
): TypeSpecificValues =>
  Object.fromEntries(
    keys.map((key) => [key, values[key]]).filter(([, value]) => value !== undefined),
  ) as TypeSpecificValues;

const applicableIssueTypes = (
  existing: ExistingCustomField,
  issueTypes: CustomFieldsSnapshot["issueTypes"],
  index: number,
  report: Report,
): string[] =>
  existing.applicableIssueTypes.flatMap((issueTypeId, reference) => {
    const issueType = issueTypes.find(({ id }) => id === issueTypeId);

    if (issueType === undefined) {
      report(
        unknownApplicableIssueType(
          path("customFields", index, "applicableIssueTypes", reference),
          existing.name,
          issueTypeId,
        ),
      );

      return [];
    }

    return [escaped(issueType.name)];
  });

const toCustomFields = (snapshot: CustomFieldsSnapshot, report: Report): CustomField[] => {
  reportName(report, "customFields", "custom field", snapshot.customFields);

  return snapshot.customFields.flatMap((existing, index) => {
    const type = CUSTOM_FIELD_TYPES_BY_ID.get(existing.typeId);

    if (type === undefined) {
      report(
        unknownCustomFieldType(path("customFields", index, "type"), existing.name, existing.typeId),
      );

      return [];
    }

    const initialValueType =
      existing.initialValueType === undefined
        ? undefined
        : INITIAL_VALUE_TYPES_BY_ID.get(existing.initialValueType);

    if (existing.initialValueType !== undefined && initialValueType === undefined) {
      report(
        unknownInitialValueType(
          path("customFields", index, "initialValueType"),
          existing.name,
          existing.initialValueType,
        ),
      );

      return [];
    }

    const keys = typeSpecificCustomFieldKeys(type, initialValueType);

    if (keys.includes("items") && (existing.items ?? []).length === 0) {
      report(listWithoutItems(path("customFields", index, "items"), existing.name));
    }

    const names = applicableIssueTypes(existing, snapshot.issueTypes, index, report);

    return [
      {
        name: escaped(existing.name),
        type,
        ...(existing.description === undefined
          ? {}
          : { description: escaped(existing.description) }),
        ...(existing.required === undefined ? {} : { required: existing.required }),
        ...(names.length === 0 ? {} : { applicableIssueTypes: names }),
        ...projected(typeSpecificValues(existing, initialValueType), keys),
      },
    ];
  });
};

/**
 * チーム経由でも個人参加している人を落とさない（EX-8）。落とすと、読み戻した計画が
 * その人の個人参加を削除する Action を出す。V-A16 の警告は適用を止めない。
 */
const toAccess = ({
  teams,
  members,
  administrators,
}: AccessSnapshot): NonNullable<ManifestInput["access"]> => {
  const administratorIds = new Set(administrators.map(({ userId }) => userId));

  return {
    teams: teams.map(({ name }) => escaped(name)),
    members: members
      .filter(({ userId }) => !administratorIds.has(userId))
      .map(({ userId }) => escaped(userId)),
    administrators: administrators.map(({ userId }) => escaped(userId)),
  };
};

const webhookVariable = (index: number): string => `WEBHOOK_URL_${index + 1}`;

const events = (activityTypeIds: number[]): WebhookEvent[] =>
  ascendingEventIds(activityTypeIds).map((id) => WEBHOOK_EVENT_NAMES_BY_ID.get(id) ?? id);

const toWebhooks = (existing: WebhooksSnapshot, report: Report): Webhook[] => {
  reportName(report, "webhooks", "webhook", existing);

  return existing.map(({ name, description, allEvent, activityTypeIds }, index) => {
    if (!allEvent && activityTypeIds.length === 0) {
      report(webhookWithoutEvents(path("webhooks", index, "events"), name));
    }

    return {
      name: escaped(name),
      ...(description === undefined ? {} : { description: escaped(description) }),
      hookUrl: `\${${webhookVariable(index)}}`,
      events: allEvent ? "all" : events(activityTypeIds),
    };
  });
};

/**
 * 位置を持つ SourceMap を組み立てない（DG-5）。当てる相手は書き出す前のマニフェストで、
 * 利用者が直す場所は Backlog 側にあるので、指せる行がそもそも無い。
 */
const NO_SOURCE: SourceMap = {
  positionAt: () => ({ line: 0, column: 0 }),
  isEmptySource: () => false,
};

/**
 * 書き出す前に、自分の出力へ S3 と S4 を当てる（EX-9h）。日付の形や `min` と `max` の
 * 前後関係のように、写像が壊しうる規則は既にスキーマと S4 が持っている。同じ規則を
 * 書き出し側にもう一度書くと、M-1 が退けた二重管理になる。
 *
 * 警告は落とす。`export` は警告を出さない（CL-8）し、V-A24 の数値イベントは
 * EX-12 が意図して通している。同じ位置に EX-9 の指摘が既にあるものも落とす。
 * 直し方は EX-9 の側が具体的に言えるので、重ねると同じ1行に2つの hint が付く。
 */
const unwritableValues = (manifest: ManifestInput, reported: Diagnostic[]): Diagnostic[] => {
  const covered = new Set(reported.map((diagnostic) => diagnostic.path));

  return [
    ...validateSchema(manifest),
    ...validateStaticSemantics(normalizeManifest(manifest), NO_SOURCE, new Set()),
  ]
    .filter((diagnostic) => diagnostic.severity === "error" && !covered.has(diagnostic.path))
    .map(cannotBeWritten);
};

const webhookVariables = (existing: WebhooksSnapshot): WebhookVariable[] =>
  existing.map(({ name }, index) => ({ variable: webhookVariable(index), webhook: name }));

export const toManifest = (snapshots: ResourceSnapshots): ToManifestResult => {
  const project = exportableProject(snapshots);

  if (project === undefined) {
    return { diagnostics: [projectDoesNotExist(snapshots.projectKey)], webhookVariables: [] };
  }

  const diagnostics: Diagnostic[] = [];

  const report: Report = (diagnostic) => {
    diagnostics.push(diagnostic);
  };

  const settings = toSettings(project.settings, report);

  const manifest: ManifestInput = {
    key: snapshots.projectKey,
    name: escaped(project.name),
    settings,
    issueTypes: toIssueTypes(project.issueTypes, report),
    statuses: toStatuses(project.statuses, report),
    categories: toCategories(snapshots.categories, report),
    milestones: toMilestones(snapshots.milestones, report),
    customFields: toCustomFields(snapshots.customFields, report),
    access: toAccess(snapshots.access),
    webhooks: toWebhooks(snapshots.webhooks, report),
  };

  const all = [...diagnostics, ...unwritableValues(manifest, diagnostics)];

  return hasError(all)
    ? { diagnostics: all, webhookVariables: [] }
    : { diagnostics: all, manifest, webhookVariables: webhookVariables(snapshots.webhooks) };
};
