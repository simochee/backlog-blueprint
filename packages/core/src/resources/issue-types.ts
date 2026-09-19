import { type Action, type Change } from "../action";
import { type IssueType } from "../manifest";
import { type Reconciler } from "../reconciler";
import { embedRef } from "../ref";
import { defaultSlotName } from "../resolution";
import { sealChanges, sealFields, sealer, type Seal } from "../secret";
import { type IdOrRef, type Ref, type Value } from "../value";

export type ExistingIssueType = {
  id: number;
  name: string;
  color: string;
  templateSummary?: string;
  templateDescription?: string;
};

/**
 * 新規プロジェクトの既定4件は名前を持たせない。表示名はスペースの言語設定で変わり、
 * `POST /projects` の前には取得できない（§4.1）。言語ごとの名前の組を持つ案は採らない。
 * Backlog が対応言語を増やすたびに追随が要り、表に無い言語では計画そのものが組めない。
 * ID は言語に依存しないので、RF-1 の refresh が登録する位置キーで枠として指す。
 */
export type IssueTypesSnapshot =
  | { source: "project"; issueTypes: ExistingIssueType[] }
  | { source: "defaults"; slots: number };

/** 既定の課題種別は4件（API 制約） */
export const DEFAULT_ISSUE_TYPE_SLOTS = 4;

type IssueTypeResponse = {
  id: number;
  name: string;
  color: string;
  templateSummary: string | null;
  templateDescription: string | null;
};

const issueTypesPath = (key: string): string => `/api/v2/projects/${key}/issueTypes`;

const issueTypeRef = (name: string): Ref => ({ $ref: { kind: "issueType", name } });

const slotRef = (slot: number): Ref => issueTypeRef(defaultSlotName(slot));

const basePath = (index: number): string => `issueTypes/${index}`;

const memberPath = (key: string, target: IdOrRef): string =>
  `${issueTypesPath(key)}/${typeof target === "number" ? target : embedRef(target)}`;

const optional = (value: string | null): string | undefined => value ?? undefined;

/**
 * 書かれていないキーを「空にする」と解釈しない。`templateSummary` を消す意図と
 * 書き忘れを区別する手段がマニフェストに無く、K-3 が `settings` について定めた
 * 「省略は現状維持」から外れる根拠も無い。
 */
const declaredFields = (desired: IssueType): Record<string, Value> => ({
  name: desired.name,
  color: desired.color,
  ...(desired.templateSummary === undefined ? {} : { templateSummary: desired.templateSummary }),
  ...(desired.templateDescription === undefined
    ? {}
    : { templateDescription: desired.templateDescription }),
});

const changesOf = (desired: IssueType, existing: ExistingIssueType | undefined): Change[] => {
  const before: Record<string, Value | undefined> = {
    name: existing?.name,
    color: existing?.color,
    templateSummary: existing?.templateSummary,
    templateDescription: existing?.templateDescription,
  };

  return Object.entries(declaredFields(desired))
    .filter(([field, after]) => before[field] !== after)
    .map(([field, after]) => ({ field, before: before[field] ?? null, after }));
};

/**
 * 既定枠を引き継ぐときも `op` は `create` にする。PO-1 が `oldname` のリネームを `~` で
 * 表すと決めたのは、利用者が `oldname` を書いた効果を plan に出すためであり、
 * ツールが新規プロジェクトで勝手に行う引き継ぎにはその理由が無い。利用者から見れば、
 * 何も無いところに課題種別を1つ宣言しただけである。
 *
 * 既定を全削除して作り直す形は採らない。L-2 / L-6 が数えている節約
 * （既定を使い回せば削除＋作成の2リクエストが1リクエストで済む）が丸ごと消える。
 */
const createAction = (
  item: IssueType,
  index: number,
  key: string,
  seal: Seal,
  slot?: number,
): Action => ({
  id: `issueTypes/create/${item.name}`,
  phase: 2,
  kind: "issueType",
  op: "create",
  name: item.name,
  ...(slot === undefined ? {} : { target: slotRef(slot) }),
  request: {
    ...(slot === undefined
      ? { method: "POST" as const, path: issueTypesPath(key) }
      : { method: "PATCH" as const, path: memberPath(key, slotRef(slot)) }),
    params: sealFields(declaredFields(item), basePath(index), seal),
  },
  provides: [{ kind: "issueType", name: item.name }],
  changes: sealChanges(changesOf(item, undefined), basePath(index), seal),
  writeRequest: true,
});

const planDefaults = (desired: IssueType[], slots: number, key: string, seal: Seal): Action[] => {
  const adopted = desired
    .slice(0, slots)
    .map((item, slot) => createAction(item, slot, key, seal, slot));
  const creates = desired
    .slice(slots)
    .map((item, offset) => createAction(item, slots + offset, key, seal));
  const substitute = desired.at(0);
  const spare = Array.from({ length: Math.max(0, slots - desired.length) }, (_, offset) => {
    const slot = desired.length + offset;

    return { slot, name: defaultSlotName(slot) };
  });

  const deletes =
    substitute === undefined
      ? []
      : spare.map(({ slot, name }): Action => ({
          id: `issueTypes/delete/${name}`,
          phase: 2,
          kind: "issueType",
          op: "delete",
          name,
          target: slotRef(slot),
          request: {
            method: "DELETE",
            path: memberPath(key, slotRef(slot)),
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
  seal: Seal,
): Action[] => {
  const byName = new Map(snapshot.map((issueType) => [issueType.name, issueType]));
  const kept = new Set<string>();
  const creates: Action[] = [];
  const updates: Action[] = [];

  const updateAction = (item: IssueType, index: number, existing: ExistingIssueType): Action => ({
    id: `issueTypes/update/${item.name}`,
    phase: 2,
    kind: "issueType",
    op: "update",
    name: item.name,
    target: existing.id,
    request: {
      method: "PATCH",
      path: memberPath(key, existing.id),
      params: sealFields(declaredFields(item), basePath(index), seal),
    },
    changes: sealChanges(changesOf(item, existing), basePath(index), seal),
    ...(existing.name === item.name
      ? {}
      : {
          notes: [{ type: "renamed" as const, from: existing.name }],
          provides: [{ kind: "issueType" as const, name: item.name }],
        }),
    writeRequest: true,
  });

  for (const [index, item] of desired.entries()) {
    const sameName = byName.get(item.name);

    if (sameName !== undefined) {
      kept.add(sameName.name);

      updates.push(
        changesOf(item, sameName).length === 0
          ? {
              id: `issueTypes/noop/${item.name}`,
              phase: 2,
              kind: "issueType",
              op: "noop",
              name: item.name,
              target: sameName.id,
              writeRequest: false,
            }
          : updateAction(item, index, sameName),
      );

      continue;
    }

    const renamed = item.oldname === undefined ? undefined : byName.get(item.oldname);

    if (renamed !== undefined) {
      kept.add(renamed.name);
      updates.push(updateAction(item, index, renamed));

      continue;
    }

    creates.push(createAction(item, index, key, seal));
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

    const response = (await ctx.get(issueTypesPath(ctx.projectKey))) as IssueTypeResponse[];

    return {
      source: "project",
      issueTypes: response.map((issueType) => ({
        id: issueType.id,
        name: issueType.name,
        color: issueType.color,
        templateSummary: optional(issueType.templateSummary),
        templateDescription: optional(issueType.templateDescription),
      })),
    };
  },

  plan(desired, snapshot, ctx) {
    const { key } = ctx.manifest;
    const seal = sealer(ctx.isSecret);

    return snapshot.source === "defaults"
      ? planDefaults(desired, snapshot.slots, key, seal)
      : planProject(desired, snapshot.issueTypes, key, seal);
  },
};
