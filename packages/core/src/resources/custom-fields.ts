import { type Action, type Change } from "../action";
import { CUSTOM_FIELD_TYPE_IDS, INITIAL_VALUE_TYPE_IDS, type CustomField } from "../manifest";
import { type Reconciler } from "../reconciler";
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

export type ExistingCustomField = { id: number } & CustomFieldFields;

export type CustomFieldsSnapshot = ExistingCustomField[];

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

const collectionPath = (projectKey: string) => `/api/v2/projects/${projectKey}/customFields`;

const memberPath = (projectKey: string, id: number) => `${collectionPath(projectKey)}/${id}`;

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

const findExisting = (snapshot: CustomFieldsSnapshot, { name, oldname }: CustomField) =>
  snapshot.find((customField) => customField.name === name) ??
  snapshot.find((customField) => customField.name === oldname);

/**
 * マニフェストに書かれていないキーは比較にも送信にも載せない（K-3）。
 *
 * `applicableIssueTypes` はここに載せない。マニフェストは課題種別を名前で指し、
 * スナップショット（§4.1）が持つのは ID で、課題種別の名前は phase 6 の read の
 * 範囲外にある。突き合わせられない値を差分に載せると、一致していても毎回
 * update が出て L-5 / NFR-4 が崩れる。送信には常に載せる（L-3）。
 */
const changesOf = (
  desired: CustomFieldFields,
  existing: ExistingCustomField | undefined,
): Change[] =>
  FIELDS.filter((field) => desired[field] !== undefined).map((field) => ({
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

const paramsOf = (changes: Change[], applicableIssueTypes: string[]) => ({
  ...Object.fromEntries(changes.map(({ field, after }) => [field, after])),
  ...(applicableIssueTypes.length === 0
    ? {}
    : {
        applicableIssueTypes: applicableIssueTypes.map((name) => ({
          $ref: { kind: "issueType" as const, name },
        })),
      }),
});

export const customFieldsReconciler: Reconciler<CustomField[], CustomFieldsSnapshot> = {
  kind: "customField",
  phase: 6,

  read: async ({ projectKey, snapshot, get }) => {
    if (!snapshot.project.exists) {
      return [];
    }

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
    }[];

    return customFields.map((customField) => ({
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
    }));
  },

  plan: (desired, snapshot, { manifest }) => {
    const creates: Action[] = [];
    const updates: Action[] = [];
    const kept = new Set<number>();

    for (const customField of desired) {
      const existing = findExisting(snapshot, customField);
      const changes = changesOf(fieldsOf(customField), existing);
      const params = paramsOf(changes, customField.applicableIssueTypes ?? []);

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

      if (changes.every(({ before, after }) => sameValue(before, after))) {
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

    const deletes = snapshot
      .filter(({ id }) => !kept.has(id))
      .map((existing): Action => ({
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
      }));

    return [...creates, ...updates, ...deletes];
  },
};
