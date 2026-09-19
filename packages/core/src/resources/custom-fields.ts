import { type Action, type Change } from "../action";
import { CUSTOM_FIELD_TYPE_IDS, INITIAL_VALUE_TYPE_IDS, type CustomField } from "../manifest";
import { type Reconciler } from "../reconciler";
import { sealChanges, sealer } from "../secret";
import { type Value } from "../value";

type CustomFieldFields = {
  name: string;
  typeId: number;
  description?: string;
  required?: boolean;
  min?: number | string;
  max?: number | string;
  initialValue?: number;
  unit?: string;
  initialDate?: string;
  initialValueType?: number;
  initialShift?: number;
  items?: string[];
  allowInput?: boolean;
  allowAddItem?: boolean;
};

export type ExistingCustomField = {
  id: number;
  applicableIssueTypes: number[];
} & CustomFieldFields;

/**
 * 課題種別も一緒に持つ（§4.1）。マニフェストは課題種別を名前で指し、カスタム属性の
 * 応答が持つのは ID なので、対応表が無いと `applicableIssueTypes` を突き合わせられない。
 * 突き合わせを諦めると「`applicableIssueTypes` だけを変えても差分が出ない」穴ができる。
 */
export type CustomFieldsSnapshot = {
  customFields: ExistingCustomField[];
  issueTypes: { id: number; name: string }[];
};

const FIELDS = [
  "name",
  "typeId",
  "description",
  "required",
  "min",
  "max",
  "initialValue",
  "unit",
  "initialDate",
  "initialValueType",
  "initialShift",
  "items",
  "allowInput",
  "allowAddItem",
] as const;

/**
 * `typeId` を更新のリクエストに載せない。`PATCH` のパラメータに無い（API 制約）ので、
 * 載せても型は変わらない。載せたままにすると、型を変えたつもりの利用者に
 * 「送ったのに変わらない」計画を見せることになる（§6.3a）。
 */
const UPDATABLE_FIELDS = FIELDS.filter((field) => field !== "typeId");

const APPLICABLE = "applicableIssueTypes";

const collectionPath = (projectKey: string) => `/api/v2/projects/${projectKey}/customFields`;

const issueTypesPath = (projectKey: string) => `/api/v2/projects/${projectKey}/issueTypes`;

const memberPath = (projectKey: string, id: number) => `${collectionPath(projectKey)}/${id}`;

const basePath = (index: number) => `customFields/${index}`;

/**
 * 日付型の `min` / `max` / `initialDate` は `yyyy-MM-dd` の文字列で、数値型の
 * `min` / `max` は数値である（API 制約）。応答が時刻付きの日付を返した場合に
 * 毎回 update が出るのを避けるため、文字列のときだけ日付部分に切り詰める。
 */
const asRange = (value: number | string | null | undefined) =>
  typeof value === "string" ? value.slice(0, 10) : (value ?? undefined);

const asDate = (value: string | null | undefined) => value?.slice(0, 10);

const asText = (value: string | null | undefined) => value ?? undefined;

const fieldsOf = (desired: CustomField): CustomFieldFields => ({
  name: desired.name,
  typeId: CUSTOM_FIELD_TYPE_IDS[desired.type],
  description: desired.description,
  required: desired.required,
  min: desired.min,
  max: desired.max,
  initialValue: desired.initialValue,
  unit: desired.unit,
  initialDate: desired.initialDate,
  initialValueType:
    desired.initialValueType === undefined
      ? undefined
      : INITIAL_VALUE_TYPE_IDS[desired.initialValueType],
  initialShift: desired.initialShift,
  items: desired.items,
  allowInput: desired.allowInput,
  allowAddItem: desired.allowAddItem,
});

const findExisting = (snapshot: ExistingCustomField[], { name, oldname }: CustomField) =>
  snapshot.find((customField) => customField.name === name) ??
  snapshot.find((customField) => customField.name === oldname);

/**
 * マニフェストに書かれていないキーは比較にも送信にも載せない（K-3）。
 * `applicableIssueTypes` は ID と名前の突き合わせが要るので、この表には載せない。
 */
const changesOf = (
  desired: CustomFieldFields,
  existing: ExistingCustomField | undefined,
  fields: readonly (keyof CustomFieldFields)[],
): Change[] =>
  fields
    .filter((field) => desired[field] !== undefined)
    .map((field) => ({
      field,
      before: existing?.[field] ?? null,
      after: desired[field] ?? null,
    }));

const sameValue = (before: Value | null, after: Value | null) => {
  if (Array.isArray(before) && Array.isArray(after)) {
    return before.length === after.length && before.every((item, index) => item === after[index]);
  }

  return before === after;
};

/**
 * 送信は課題種別の ID を要求する（API 制約）が、差分は名前のまま持つ。ID は適用の
 * 途中でしか分からないものが混ざるため、参照をそのまま前後差分に置くと
 * 「何がどう変わるのか」が読めなくなる。`statuses` の displayOrder と同じ扱い。
 */
const paramsOf = (changes: Change[], applicableIssueTypes: string[]) => ({
  ...Object.fromEntries(
    changes.filter(({ field }) => field !== APPLICABLE).map(({ field, after }) => [field, after]),
  ),
  ...(applicableIssueTypes.length === 0
    ? {}
    : {
        applicableIssueTypes: applicableIssueTypes.map((name) => ({
          $ref: { kind: "issueType" as const, name },
        })),
      }),
});

/**
 * 並びを無視した集合として比べる。Backlog が返す順序はマニフェストの記述順と
 * 関係が無く、順序で比べると一致していても毎回 update が出て NFR-4 が崩れる。
 */
const sameNames = (left: string[], right: string[]): boolean => {
  const expected = new Set(right);

  return new Set(left).size === expected.size && left.every((name) => expected.has(name));
};

/**
 * 名前を引けなかった ID を落とさない。落とすと現状が短く見えて「一致した」と
 * 誤判定し、`applicableIssueTypes` の差分が出なくなる。
 */
const applicableNames = (ids: number[], issueTypes: { id: number; name: string }[]): string[] =>
  ids.map((id) => issueTypes.find((issueType) => issueType.id === id)?.name ?? String(id));

export const customFieldsReconciler: Reconciler<CustomField[], CustomFieldsSnapshot> = {
  kind: "customField",
  phase: 6,

  read: async ({ projectKey, snapshot, get }) => {
    if (!snapshot.project.exists) {
      return { customFields: [], issueTypes: [] };
    }

    const issueTypes = (await get(issueTypesPath(projectKey))) as { id: number; name: string }[];

    const customFields = (await get(collectionPath(projectKey))) as {
      id: number;
      name: string;
      typeId: number;
      description?: string | null;
      required?: boolean;
      min?: number | string | null;
      max?: number | string | null;
      initialValue?: number | null;
      unit?: string | null;
      initialDate?: string | null;
      initialValueType?: number | null;
      initialShift?: number | null;
      items?: { name: string }[] | null;
      allowInput?: boolean;
      allowAddItem?: boolean;
      applicableIssueTypes?: number[] | null;
    }[];

    const mapped = customFields.map((customField) => ({
      id: customField.id,
      name: customField.name,
      typeId: customField.typeId,
      description: asText(customField.description),
      required: customField.required,
      min: asRange(customField.min),
      max: asRange(customField.max),
      initialValue: customField.initialValue ?? undefined,
      unit: asText(customField.unit),
      initialDate: asDate(customField.initialDate),
      initialValueType: customField.initialValueType ?? undefined,
      initialShift: customField.initialShift ?? undefined,
      items: customField.items?.map(({ name }) => name),
      allowInput: customField.allowInput,
      allowAddItem: customField.allowAddItem,
      applicableIssueTypes: customField.applicableIssueTypes ?? [],
    }));

    return { customFields: mapped, issueTypes: issueTypes.map(({ id, name }) => ({ id, name })) };
  },

  plan: (desired, { customFields: snapshot, issueTypes }, { manifest, isSecret }) => {
    const seal = sealer(isSecret);
    const creates: Action[] = [];
    const updates: Action[] = [];
    const kept = new Set<number>();

    const replaced: ExistingCustomField[] = [];

    for (const [index, customField] of desired.entries()) {
      const fields = fieldsOf(customField);
      const found = findExisting(snapshot, customField);
      /**
       * 型が変わったら作り直す（§6.3a）。同名のまま `PATCH` すると、型は変わらないのに
       * 成功が返り、マニフェストと現実が食い違ったまま apply が完了する。
       */
      const recreated = found !== undefined && found.typeId !== fields.typeId;
      const existing = recreated ? undefined : found;
      /**
       * 一致の判定は包む前の値で行う。`Secret` は `===` で一致しないので、包んだ値を
       * 比べると `${ENV}` を書いたカスタム属性が毎回 update になり NFR-4 が崩れる。
       */
      const declared = changesOf(
        fields,
        existing,
        existing === undefined ? FIELDS : UPDATABLE_FIELDS,
      );
      const applicable = customField.applicableIssueTypes ?? [];
      const current =
        existing === undefined
          ? undefined
          : applicableNames(existing.applicableIssueTypes, issueTypes);
      const applicableMatches =
        applicable.length === 0 || (current !== undefined && sameNames(current, applicable));
      const changes = [
        ...sealChanges(declared, basePath(index), seal),
        ...(applicable.length === 0
          ? []
          : [{ field: APPLICABLE, before: current ?? null, after: applicable }]),
      ];
      const params = paramsOf(changes, applicable);

      if (found !== undefined && recreated) {
        kept.add(found.id);
        replaced.push(found);
      }

      if (existing === undefined) {
        creates.push({
          id: `customFields/create/${customField.name}`,
          phase: 6,
          kind: "customField",
          op: "create",
          name: customField.name,
          request: { method: "POST", path: collectionPath(manifest.key), params },
          provides: [{ kind: "customField", name: customField.name }],
          changes,
          writeRequest: true,
        });

        continue;
      }

      kept.add(existing.id);

      if (applicableMatches && declared.every(({ before, after }) => sameValue(before, after))) {
        updates.push({
          id: `customFields/noop/${customField.name}`,
          phase: 6,
          kind: "customField",
          op: "noop",
          name: customField.name,
          target: existing.id,
          writeRequest: false,
        });

        continue;
      }

      const renamed = existing.name !== customField.name;

      updates.push({
        id: `customFields/update/${customField.name}`,
        phase: 6,
        kind: "customField",
        op: "update",
        name: customField.name,
        target: existing.id,
        request: { method: "PATCH", path: memberPath(manifest.key, existing.id), params },
        ...(renamed
          ? { provides: [{ kind: "customField" as const, name: customField.name }] }
          : {}),
        changes,
        ...(renamed ? { notes: [{ type: "renamed" as const, from: existing.name }] } : {}),
        writeRequest: true,
      });
    }

    const deletes = [...snapshot.filter(({ id }) => !kept.has(id)), ...replaced].map(
      (existing): Action => ({
        id: `customFields/delete/${existing.name}`,
        phase: 6,
        kind: "customField",
        op: "delete",
        name: existing.name,
        target: existing.id,
        request: {
          method: "DELETE",
          path: memberPath(manifest.key, existing.id),
          params: {},
        },
        writeRequest: true,
      }),
    );

    return [...creates, ...updates, ...deletes];
  },
};
