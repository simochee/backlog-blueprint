import { Document, isScalar, isSeq } from "yaml";

import {
  type Category,
  type CustomField,
  type IssueType,
  type ManifestInput,
  type Milestone,
  type Settings,
  type Status,
  type Webhook,
} from "../manifest";
import { projectSchemaUrl } from "../schema-url";
import { YAML_SCHEMA_OPTIONS } from "../validation/syntax-stage";

export type AccessLabels = {
  teams: ReadonlyMap<number, string>;
  users: ReadonlyMap<number, string>;
};

export type SerializeOptions = {
  version: string;
  accessLabels?: AccessLabels;
};

export type AccessEntry = { value: number; label?: string };

/**
 * 既定のままにできないもの。`aliasDuplicateObjects` を切らないと同じ内容の要素が
 * `&a1` / `*a1` になる。`lineWidth: 0` が無いと80桁で折り返し、長い1行は二重引用符と
 * 継続行に化ける。`blockQuote: "literal"` が無いと折り畳みスカラー（`>`）が選ばれ、
 * 末尾改行の有無が値のとおりに残らない。`singleQuote: false` が無いと、二重引用符を
 * 含む値だけ単引用符で囲まれる。
 */
const STRINGIFY_OPTIONS = {
  ...YAML_SCHEMA_OPTIONS,
  indent: 2,
  indentSeq: true,
  lineWidth: 0,
  blockQuote: "literal",
  singleQuote: false,
  aliasDuplicateObjects: false,
  sortMapEntries: false,
} as const;

type KeyOrder<Value> = Record<keyof Value, null>;

type Unordered<Key extends string> = Partial<Record<Key, unknown>>;

/**
 * 並びを文字列の配列で持たない。`Record<keyof Value, null>` はスキーマにキーが増えたとき
 * 型エラーになるが、配列は書き漏らしたキーを黙って出力から落とす。
 */
const inOrder = <Key extends string>(
  order: Record<Key, null>,
  value: Unordered<Key>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.keys(order)
      .map((key) => [key, value[key as Key]] as const)
      .filter(([, item]) => item !== undefined),
  );

const inOrderEach = <Key extends string>(
  order: Record<Key, null>,
  items: Unordered<Key>[] | undefined,
): Record<string, unknown>[] | undefined => items?.map((item) => inOrder(order, item));

const SETTINGS_ORDER: KeyOrder<Settings> = {
  textFormattingRule: null,
  chartEnabled: null,
  useResolvedForChart: null,
  subtaskingEnabled: null,
  grandchildIssueEnabled: null,
  projectLeaderCanEditProjectLeader: null,
  useWiki: null,
  useWikiTreeView: null,
  useOriginalImageSizeAtWiki: null,
  useDocument: null,
  useFileSharing: null,
  useGit: null,
  useSubversion: null,
  useDevAttributes: null,
};

const ISSUE_TYPE_ORDER: KeyOrder<IssueType> = {
  name: null,
  color: null,
  templateSummary: null,
  templateDescription: null,
  oldname: null,
};

const STATUS_ORDER: KeyOrder<Status> = { name: null, color: null, oldname: null };

const CATEGORY_ORDER: KeyOrder<Category> = { name: null, oldname: null };

const MILESTONE_ORDER: KeyOrder<Milestone> = {
  name: null,
  description: null,
  startDate: null,
  releaseDueDate: null,
  oldname: null,
};

const CUSTOM_FIELD_ORDER: KeyOrder<CustomField> = {
  name: null,
  type: null,
  description: null,
  required: null,
  applicableIssueTypes: null,
  oldname: null,
  min: null,
  max: null,
  initialValue: null,
  unit: null,
  initialDate: null,
  initialValueType: null,
  initialShift: null,
  items: null,
  allowInput: null,
  allowAddItem: null,
};

const WEBHOOK_ORDER: KeyOrder<Webhook> = {
  name: null,
  description: null,
  hookUrl: null,
  events: null,
};

type AccessInput = NonNullable<ManifestInput["access"]>;

const ACCESS_ORDER: KeyOrder<AccessInput> = { teams: null, members: null, administrators: null };

type ManifestBody = Omit<ManifestInput, "$schema">;

const MANIFEST_ORDER: KeyOrder<ManifestBody> = {
  key: null,
  name: null,
  settings: null,
  issueTypes: null,
  statuses: null,
  categories: null,
  milestones: null,
  customFields: null,
  access: null,
  webhooks: null,
};

/**
 * 空になった `settings` を `{}` として書かない（EX-14）。K-3 のもとで
 * `settings: {}` は読み手に何も伝えない。配列キーは0件でも書くので通さない。
 */
const omitEmpty = (value: Record<string, unknown>): Record<string, unknown> | undefined =>
  Object.keys(value).length > 0 ? value : undefined;

const manifestBody = (manifest: ManifestInput): Record<string, unknown> =>
  inOrder(MANIFEST_ORDER, {
    key: manifest.key,
    name: manifest.name,
    settings: manifest.settings && omitEmpty(inOrder(SETTINGS_ORDER, manifest.settings)),
    issueTypes: inOrderEach(ISSUE_TYPE_ORDER, manifest.issueTypes),
    statuses: inOrderEach(STATUS_ORDER, manifest.statuses),
    categories: inOrderEach(CATEGORY_ORDER, manifest.categories),
    milestones: inOrderEach(MILESTONE_ORDER, manifest.milestones),
    customFields: inOrderEach(CUSTOM_FIELD_ORDER, manifest.customFields),
    access: manifest.access && inOrder(ACCESS_ORDER, manifest.access),
    webhooks: inOrderEach(WEBHOOK_ORDER, manifest.webhooks),
  });

type LabelOf = (value: unknown, index: number) => string | undefined;

/**
 * 名前が値そのものと同じなら付けない。`- 31 # 31` は何も足さずに行を読みにくくする。
 */
const labelEach = (document: Document, path: string[], labelOf: LabelOf): void => {
  const sequence = document.getIn(path, true);

  if (!isSeq(sequence)) {
    return;
  }

  for (const [index, item] of sequence.items.entries()) {
    if (!isScalar(item)) {
      continue;
    }

    const label = labelOf(item.value, index);

    if (label !== undefined && label !== "" && label !== String(item.value)) {
      item.comment = ` ${label}`;
    }
  }
};

const labelAccess = (document: Document, labels: AccessLabels): void => {
  labelEach(document, ["access", "teams"], (value) =>
    typeof value === "number" ? labels.teams.get(value) : undefined,
  );

  for (const section of ["members", "administrators"]) {
    labelEach(document, ["access", section], (value) =>
      typeof value === "number" ? labels.users.get(value) : undefined,
    );
  }
};

export const serializeManifest = (manifest: ManifestInput, options: SerializeOptions): string => {
  const document = new Document(manifestBody(manifest), STRINGIFY_OPTIONS);

  if (options.accessLabels !== undefined) {
    labelAccess(document, options.accessLabels);
  }

  return `# yaml-language-server: $schema=${projectSchemaUrl(options.version)}\n${document.toString(STRINGIFY_OPTIONS)}`;
};

/**
 * 系列だけを書き出して段を足す形にしない（WU-23）。段付けを別に持つことになり、
 * STRINGIFY_OPTIONS を変えたときに貼った行だけが export の出力とずれる。
 */
export const serializeAccessEntries = (entries: AccessEntry[]): string => {
  const document = new Document(
    { access: { entries: entries.map(({ value }) => value) } },
    STRINGIFY_OPTIONS,
  );

  labelEach(document, ["access", "entries"], (_, index) => entries[index]?.label);

  return document.toString(STRINGIFY_OPTIONS).split("\n").slice(2).join("\n");
};
