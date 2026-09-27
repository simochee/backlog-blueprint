import { declaredOnly, differs, fieldChanges, type Action, type Change } from "../action";
import { CUSTOM_FIELD_TYPE_IDS, INITIAL_VALUE_TYPE_IDS, type CustomField } from "../manifest";
import { type Reconciler } from "../reconciler";
import {
  asArrayOf,
  asRecord,
  numberOrDate,
  numbers,
  optionalBoolean,
  optionalDate,
  optionalNumber,
  optionalString,
  requiredNumber,
  requiredString,
} from "../api-response";

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
 * 課題種別の対応表も持つ。応答は ID で、マニフェストは名前で指すので、無いと
 * `applicableIssueTypes` だけを変えても差分が出ない（§4.1）。
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
 * `typeId` を更新に載せない。`PATCH` は受け付けず（API 制約）、型を変えたつもりの利用者に
 * 「送ったのに変わらない」計画を見せる（§6.3a）。
 */
const UPDATABLE_FIELDS = FIELDS.filter((field) => field !== "typeId");

const APPLICABLE = "applicableIssueTypes";

const collectionPath = (projectKey: string) => `/api/v2/projects/${projectKey}/customFields`;

const issueTypesPath = (projectKey: string) => `/api/v2/projects/${projectKey}/issueTypes`;

const memberPath = (projectKey: string, id: number) => `${collectionPath(projectKey)}/${id}`;

/** 選択肢の `id` は持たない。応答は `{ id, name }` だが、マニフェストは名前しか書けない。 */
const itemsOf = (record: Record<string, unknown>): string[] | undefined => {
  const { items } = record;

  if (items === undefined || items === null) {
    return undefined;
  }

  return asArrayOf(items, (item) => requiredString(asRecord(item), "name"));
};

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

const findExistingCustomField = (
  snapshot: ExistingCustomField[],
  { name, oldname }: CustomField,
): ExistingCustomField | undefined =>
  snapshot.find((customField) => customField.name === name) ??
  snapshot.find((customField) => customField.name === oldname);

/** `applicableIssueTypes` はここで比べない。ID と名前の突き合わせが要る。 */
const changesOf = (
  desired: CustomFieldFields,
  existing: ExistingCustomField | undefined,
  fields: readonly (keyof CustomFieldFields)[],
): Change[] =>
  fieldChanges(
    declaredOnly(Object.fromEntries(fields.map((field) => [field, desired[field]]))),
    existing ?? {},
  );

/**
 * 差分に参照を置かない。送信は ID を要求するが、適用の途中でしか分からない ID が混ざり、
 * 何がどう変わるのかが読めなくなる（PO-12）。
 *
 * 空の配列を「送らない」に畳まない。空は絞りの解除で（K-1 / §9）、畳むとキーを消しても
 * 絞りが残る。
 */
const paramsOf = (changes: Change[], applicableIssueTypes: string[] | undefined) => ({
  ...Object.fromEntries(
    changes.filter(({ field }) => field !== APPLICABLE).map(({ field, after }) => [field, after]),
  ),
  ...(applicableIssueTypes === undefined
    ? {}
    : {
        applicableIssueTypes: applicableIssueTypes.map((name) => ({
          $ref: { kind: "issueType" as const, name },
        })),
      }),
});

/** 順序で比べない。Backlog が返す順序は記述順と関係が無く、毎回 update が出て NFR-4 が崩れる。 */
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

    const issueTypes = asArrayOf(await get(issueTypesPath(projectKey)), (item) => {
      const issueType = asRecord(item);

      return { id: requiredNumber(issueType, "id"), name: requiredString(issueType, "name") };
    });

    const mapped = asArrayOf(await get(collectionPath(projectKey)), (item) => {
      const customField = asRecord(item);

      return {
        id: requiredNumber(customField, "id"),
        name: requiredString(customField, "name"),
        typeId: requiredNumber(customField, "typeId"),
        description: optionalString(customField, "description"),
        required: optionalBoolean(customField, "required"),
        min: numberOrDate(customField, "min"),
        max: numberOrDate(customField, "max"),
        initialValue: optionalNumber(customField, "initialValue"),
        unit: optionalString(customField, "unit"),
        initialDate: optionalDate(customField, "initialDate"),
        initialValueType: optionalNumber(customField, "initialValueType"),
        initialShift: optionalNumber(customField, "initialShift"),
        items: itemsOf(customField),
        allowInput: optionalBoolean(customField, "allowInput"),
        allowAddItem: optionalBoolean(customField, "allowAddItem"),
        applicableIssueTypes: numbers(customField, "applicableIssueTypes"),
      };
    });

    return { customFields: mapped, issueTypes: issueTypes.map(({ id, name }) => ({ id, name })) };
  },

  plan: (desired, { customFields: snapshot, issueTypes }, { manifest }) => {
    const creates: Action[] = [];
    const updates: Action[] = [];
    const kept = new Set<number>();

    const replaced: ExistingCustomField[] = [];

    for (const customField of desired) {
      const fields = fieldsOf(customField);
      const found = findExistingCustomField(snapshot, customField);
      // 型が変わったら `PATCH` で済ませない。成功が返るのに型は変わらない（§6.3a）。
      const recreated = found !== undefined && found.typeId !== fields.typeId;
      const existing = recreated ? undefined : found;
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
      const applicableMatches = current !== undefined && sameNames(current, applicable);
      // `current` の判定を畳まない。解除（`applicable` が空で `current` が空でない）が
      // 差分にも本文にも現れなくなる（§9）。
      const filters = applicable.length > 0 || (current !== undefined && current.length > 0);
      const changes = [
        ...declared,
        ...(filters ? [{ field: APPLICABLE, before: current ?? null, after: applicable }] : []),
      ];
      const params = paramsOf(changes, filters ? applicable : undefined);

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

      if (applicableMatches && !differs(declared)) {
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
