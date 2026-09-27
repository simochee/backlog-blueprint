import {
  declaredOnly,
  differs,
  fieldChanges,
  type Action,
  type Change,
  type ProvidedRef,
} from "../action";
import { type IssueType } from "../manifest";
import { type Reconciler } from "../reconciler";
import { embedRef } from "../ref";
import { type IdOrRef, type Ref, type Value } from "../value";
import {
  asArrayOf,
  asRecord,
  optionalString,
  requiredNumber,
  requiredString,
} from "../api-response";

export type ExistingIssueType = {
  id: number;
  name: string;
  color: string;
  templateSummary?: string;
  templateDescription?: string;
};

/**
 * 新規プロジェクトの既定4件に名前を持たせない。表示名はスペースの言語設定で変わり、
 * 作成前には取得できない（§4.1）。言語ごとの名前の組を持つ案は、表に無い言語で計画が
 * 組めなくなるので採らない。
 */
export type IssueTypesSnapshot =
  | { source: "project"; issueTypes: ExistingIssueType[] }
  | { source: "defaults"; slots: number };

export const DEFAULT_ISSUE_TYPE_SLOTS = 4;

const issueTypesPath = (key: string): string => `/api/v2/projects/${key}/issueTypes`;

const issueTypeRef = (name: string): Ref => ({ $ref: { kind: "issueType", name } });

/**
 * 引き継ぐ枠を枠の識別子で指さない。識別子は利用者の名前と同じ名前空間に入り、
 * その表記を名前に書かれたときに黙って別の枠を書き換える（§4.1）。
 */
const slotPosition = (slot: number): string => String(slot);

const spareSlotRef = (slot: number): Ref => ({
  $ref: { kind: "issueTypeSlot", name: slotPosition(slot) },
});

/** 枠の割り当てを `project` の reconciler に書き写さない。ここでしか決まらない（RF-1）。 */
export const defaultIssueTypeSlotRefs = (desired: IssueType[]): ProvidedRef[] =>
  Array.from({ length: DEFAULT_ISSUE_TYPE_SLOTS }, (_, slot): ProvidedRef => {
    const adopted = desired[slot];

    return adopted === undefined
      ? { kind: "issueTypeSlot", name: slotPosition(slot) }
      : { kind: "issueType", name: adopted.name };
  });

const memberPath = (key: string, target: IdOrRef): string =>
  `${issueTypesPath(key)}/${typeof target === "number" ? target : embedRef(target)}`;

/**
 * 書かれていないキーを「空にする」と解釈しない。消す意図と書き忘れを区別する手段が
 * マニフェストに無い（K-3）。
 */
const declaredFields = (desired: IssueType): Record<string, Value> =>
  declaredOnly({
    name: desired.name,
    color: desired.color,
    templateSummary: desired.templateSummary,
    templateDescription: desired.templateDescription,
  });

const changesOf = (desired: IssueType, existing: ExistingIssueType | undefined): Change[] =>
  fieldChanges(declaredFields(desired), existing ?? {});

/**
 * 既定枠を引き継ぐときも PO-1 のリネーム（`~`）として出さない。`~` は利用者が `oldname` を
 * 書いた効果を出すためのもので、ツールが勝手に行う引き継ぎにはその理由が無い。
 *
 * 既定を全削除して作り直す形は採らない。L-2 / L-6 が数える節約が丸ごと消える。
 */
const createAction = (item: IssueType, key: string, adoptsSlot = false): Action => ({
  id: `issueTypes/create/${item.name}`,
  phase: 2,
  kind: "issueType",
  op: "create",
  name: item.name,
  ...(adoptsSlot ? { target: issueTypeRef(item.name) } : {}),
  request: {
    ...(adoptsSlot
      ? { method: "PATCH" as const, path: memberPath(key, issueTypeRef(item.name)) }
      : { method: "POST" as const, path: issueTypesPath(key) }),
    params: declaredFields(item),
  },
  provides: [{ kind: "issueType", name: item.name }],
  changes: changesOf(item, undefined),
  writeRequest: true,
});

const planDefaults = (desired: IssueType[], slots: number, key: string): Action[] => {
  const adopted = desired.slice(0, slots).map((item) => createAction(item, key, true));
  const creates = desired.slice(slots).map((item) => createAction(item, key));
  const substitute = desired.at(0);
  const spare = Array.from(
    { length: Math.max(0, slots - desired.length) },
    (_, offset) => desired.length + offset,
  );

  const deletes =
    substitute === undefined
      ? []
      : spare.map((slot): Action => ({
          id: `issueTypes/delete/slot/${slotPosition(slot)}`,
          phase: 2,
          kind: "issueType",
          op: "delete",
          name: slotPosition(slot),
          target: spareSlotRef(slot),
          request: {
            method: "DELETE",
            path: memberPath(key, spareSlotRef(slot)),
            params: { substituteIssueTypeId: issueTypeRef(substitute.name) },
          },
          writeRequest: true,
        }));

  return [...adopted, ...creates, ...deletes];
};

const planProject = (
  desired: IssueType[],
  snapshot: ExistingIssueType[],
  key: string,
): Action[] => {
  const byName = new Map(snapshot.map((issueType) => [issueType.name, issueType]));
  const kept = new Set<string>();
  const creates: Action[] = [];
  const updates: Action[] = [];

  const updateAction = (item: IssueType, existing: ExistingIssueType): Action => ({
    id: `issueTypes/update/${item.name}`,
    phase: 2,
    kind: "issueType",
    op: "update",
    name: item.name,
    target: existing.id,
    request: {
      method: "PATCH",
      path: memberPath(key, existing.id),
      params: declaredFields(item),
    },
    changes: changesOf(item, existing),
    ...(existing.name === item.name
      ? {}
      : {
          notes: [{ type: "renamed" as const, from: existing.name }],
          provides: [{ kind: "issueType" as const, name: item.name }],
        }),
    writeRequest: true,
  });

  for (const item of desired) {
    const sameName = byName.get(item.name);

    if (sameName !== undefined) {
      kept.add(sameName.name);

      updates.push(
        differs(changesOf(item, sameName))
          ? updateAction(item, sameName)
          : {
              id: `issueTypes/noop/${item.name}`,
              phase: 2,
              kind: "issueType",
              op: "noop",
              name: item.name,
              target: sameName.id,
              writeRequest: false,
            },
      );

      continue;
    }

    const renamed = item.oldname === undefined ? undefined : byName.get(item.oldname);

    if (renamed !== undefined) {
      kept.add(renamed.name);
      updates.push(updateAction(item, renamed));

      continue;
    }

    creates.push(createAction(item, key));
  }

  const substitute = desired.at(0);
  const deletes =
    substitute === undefined
      ? []
      : snapshot
          .filter((issueType) => !kept.has(issueType.name))
          .map((issueType): Action => ({
            id: `issueTypes/delete/${issueType.name}`,
            phase: 2,
            kind: "issueType",
            op: "delete",
            name: issueType.name,
            target: issueType.id,
            request: {
              method: "DELETE",
              path: memberPath(key, issueType.id),
              params: { substituteIssueTypeId: issueTypeRef(substitute.name) },
            },
            writeRequest: true,
          }));

  return [...creates, ...updates, ...deletes];
};

export const issueTypesReconciler: Reconciler<IssueType[], IssueTypesSnapshot> = {
  kind: "issueType",
  phase: 2,

  async read(ctx) {
    if (!ctx.snapshot.project.exists) {
      return { source: "defaults", slots: DEFAULT_ISSUE_TYPE_SLOTS };
    }

    const response = await ctx.get(issueTypesPath(ctx.projectKey));

    return {
      source: "project",
      issueTypes: asArrayOf(response, (item) => {
        const issueType = asRecord(item);

        return {
          id: requiredNumber(issueType, "id"),
          name: requiredString(issueType, "name"),
          color: requiredString(issueType, "color"),
          templateSummary: optionalString(issueType, "templateSummary"),
          templateDescription: optionalString(issueType, "templateDescription"),
        };
      }),
    };
  },

  plan(desired, snapshot, ctx) {
    const { key } = ctx.manifest;

    return snapshot.source === "defaults"
      ? planDefaults(desired, snapshot.slots, key)
      : planProject(desired, snapshot.issueTypes, key);
  },
};
