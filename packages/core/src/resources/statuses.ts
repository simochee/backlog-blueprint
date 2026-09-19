import { type Action, type Change } from "../action";
import { type Status } from "../manifest";
import { type Reconciler } from "../reconciler";
import { sealChanges, sealFields, sealer } from "../secret";
import { type IdOrRef, type Ref, type Value } from "../value";
import { asArrayOf, asRecord, requiredNumber, requiredString } from "../api-response";

export type ExistingStatus = { id: number; name: string; color: string };

/**
 * 未作成のプロジェクトを既定4件の配列で表さない。どの表示名で既定が並ぶかは
 * スペースの言語設定で決まり、`read()` はマニフェストを見られないので選べない。
 * 組を選ぶのは `plan()` である（API 制約「既定リソースの表示名」）。
 */
export type StatusesSnapshot =
  | { source: "project"; statuses: ExistingStatus[] }
  | { source: "defaults" };

/**
 * 既定ステータスは全プロジェクト共通で ID 1〜4 の固定値であり、作成前でも分かる（§4.1）。
 * 表示名はスペースの言語設定で変わるので、既定かどうかの判定にだけ ID を使う（K-5）。
 */
const LAST_DEFAULT_STATUS_ID = 4;

/**
 * 振替先を既定ステータスの探索で決めない。表示名はスペースの言語設定で変わるので
 * 名前では引けず、ID 1 は全プロジェクト共通の固定値である（§5.2 / API 制約）。
 */
const SUBSTITUTE_STATUS_ID = 1;

/**
 * 既定ステータスの表示名はスペースの言語設定で変わる（API 制約「既定リソースの表示名」）。
 * 課題種別と違って枠に寄せられない。既定ステータスは削除もリネームもできず、
 * マニフェストの4件が既定のどれに当たるかを名前でしか決められないためである。
 */
export const DEFAULT_STATUSES_JA: ExistingStatus[] = [
  { id: 1, name: "未対応", color: "#ed8077" },
  { id: 2, name: "処理中", color: "#4488c5" },
  { id: 3, name: "処理済み", color: "#5eb5a6" },
  { id: 4, name: "完了", color: "#b0be3c" },
];

export const DEFAULT_STATUSES_EN: ExistingStatus[] = [
  { id: 1, name: "Open", color: "#ed8077" },
  { id: 2, name: "In Progress", color: "#4488c5" },
  { id: 3, name: "Resolved", color: "#5eb5a6" },
  { id: 4, name: "Closed", color: "#b0be3c" },
];

const DEFAULT_STATUS_SETS: ExistingStatus[][] = [DEFAULT_STATUSES_JA, DEFAULT_STATUSES_EN];

/** V-A6 の判定と、新規プロジェクトの照合が同じ表を引くための入口 */
export const matchDefaultStatuses = (names: readonly string[]): ExistingStatus[] | undefined => {
  const declared = new Set(names);

  return DEFAULT_STATUS_SETS.find((set) => set.every(({ name }) => declared.has(name)));
};

/**
 * どちらの組にも一致しないときに日本語の組を選ぶのは、`plan()` が純粋関数で
 * 例外を持てないためである。その場合は V-A6 が S6 で止めているので、
 * ここで選んだ組が計画として出ることはない。
 */
const defaultStatuses = (desired: Status[]): ExistingStatus[] =>
  matchDefaultStatuses(desired.map(({ name }) => name)) ?? DEFAULT_STATUSES_JA;

const isDefaultStatus = ({ id }: ExistingStatus): boolean => id <= LAST_DEFAULT_STATUS_ID;

const statusesPath = (key: string): string => `/api/v2/projects/${key}/statuses`;

const statusRef = (name: string): Ref => ({ $ref: { kind: "status", name } });

const basePath = (index: number): string => `statuses/${index}`;

const sameOrder = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((name, index) => name === right[index]);

const declaredFields = (desired: Status): Record<string, Value> => ({
  name: desired.name,
  ...(desired.color === undefined ? {} : { color: desired.color }),
});

/**
 * 値が変わらない項目も落とさない（PO-11）。落とすと JSON から「送るが変わらない項目」が
 * 消え、`request.params` と突き合わせられなくなる。
 */
const changesOf = (desired: Status, existing: ExistingStatus | undefined): Change[] => {
  const before: Record<string, Value | undefined> = {
    name: existing?.name,
    color: existing?.color,
  };

  return Object.entries(declaredFields(desired)).map(([field, after]) => ({
    field,
    before: before[field] ?? null,
    after,
  }));
};

const differs = (changes: Change[]): boolean =>
  changes.some(({ before, after }) => before !== after);

/**
 * 新規カスタムは「完了」の直前に挿入される（実測）。末尾に付くと見なすと、
 * 記述順と一致しているのに並べ替えを打つ計画になり、L-5 と AC-8 の両方が崩れる。
 */
const orderAfterApply = (
  snapshot: ExistingStatus[],
  renamedTo: Map<string, string>,
  deleted: Set<string>,
  created: string[],
): string[] => {
  const remaining = snapshot
    .filter((status) => !deleted.has(status.name))
    .map((status) => renamedTo.get(status.name) ?? status.name);
  const last = snapshot.find((status) => status.id === LAST_DEFAULT_STATUS_ID);
  const insertAt = last === undefined ? remaining.length : remaining.indexOf(last.name);

  return [...remaining.slice(0, insertAt), ...created, ...remaining.slice(insertAt)];
};

export const statusesReconciler: Reconciler<Status[], StatusesSnapshot> = {
  kind: "status",
  phase: 3,

  async read(ctx) {
    if (!ctx.snapshot.project.exists) {
      return { source: "defaults" };
    }

    const response = await ctx.get(statusesPath(ctx.projectKey));

    return {
      source: "project",
      statuses: asArrayOf(response, (item) => {
        const status = asRecord(item);

        return {
          id: requiredNumber(status, "id"),
          name: requiredString(status, "name"),
          color: requiredString(status, "color"),
        };
      }),
    };
  },

  plan(desired, statusesSnapshot, ctx) {
    const { key } = ctx.manifest;
    const seal = sealer(ctx.isSecret);
    const snapshot =
      statusesSnapshot.source === "project" ? statusesSnapshot.statuses : defaultStatuses(desired);
    const byName = new Map(snapshot.map((status) => [status.name, status]));
    const kept = new Set<string>();
    const renamedTo = new Map<string, string>();
    const created: string[] = [];
    const resulting: IdOrRef[] = [];
    const creates: Action[] = [];
    const updates: Action[] = [];

    for (const [index, item] of desired.entries()) {
      const sameName = byName.get(item.name);

      if (sameName !== undefined) {
        kept.add(sameName.name);
        resulting.push(sameName.id);

        const changes = changesOf(item, sameName);

        updates.push(
          isDefaultStatus(sameName) || !differs(changes)
            ? {
                id: `statuses/noop/${item.name}`,
                phase: 3,
                kind: "status",
                op: "noop",
                name: item.name,
                target: sameName.id,
                writeRequest: false,
              }
            : {
                id: `statuses/update/${item.name}`,
                phase: 3,
                kind: "status",
                op: "update",
                name: item.name,
                target: sameName.id,
                request: {
                  method: "PATCH",
                  path: `${statusesPath(key)}/${sameName.id}`,
                  params: sealFields(declaredFields(item), basePath(index), seal),
                },
                changes: sealChanges(changes, basePath(index), seal),
                writeRequest: true,
              },
        );

        continue;
      }

      const renameSource = item.oldname === undefined ? undefined : byName.get(item.oldname);
      const renamed =
        renameSource !== undefined && isDefaultStatus(renameSource) ? undefined : renameSource;

      if (renamed !== undefined) {
        kept.add(renamed.name);
        renamedTo.set(renamed.name, item.name);
        resulting.push(renamed.id);

        updates.push({
          id: `statuses/update/${item.name}`,
          phase: 3,
          kind: "status",
          op: "update",
          name: item.name,
          target: renamed.id,
          request: {
            method: "PATCH",
            path: `${statusesPath(key)}/${renamed.id}`,
            params: sealFields(declaredFields(item), basePath(index), seal),
          },
          changes: sealChanges(changesOf(item, renamed), basePath(index), seal),
          notes: [{ type: "renamed", from: renamed.name }],
          provides: [{ kind: "status", name: item.name }],
          writeRequest: true,
        });

        continue;
      }

      created.push(item.name);
      resulting.push(statusRef(item.name));

      creates.push({
        id: `statuses/create/${item.name}`,
        phase: 3,
        kind: "status",
        op: "create",
        name: item.name,
        request: {
          method: "POST",
          path: statusesPath(key),
          params: sealFields(declaredFields(item), basePath(index), seal),
        },
        provides: [{ kind: "status", name: item.name }],
        changes: sealChanges(changesOf(item, undefined), basePath(index), seal),
        writeRequest: true,
      });
    }

    const removed = snapshot.filter((status) => !isDefaultStatus(status) && !kept.has(status.name));
    const deletes = removed.map((status): Action => ({
      id: `statuses/delete/${status.name}`,
      phase: 3,
      kind: "status",
      op: "delete",
      name: status.name,
      target: status.id,
      request: {
        method: "DELETE",
        path: `${statusesPath(key)}/${status.id}`,
        params: { substituteStatusId: SUBSTITUTE_STATUS_ID },
      },
      writeRequest: true,
    }));

    const order = desired.map((item) => item.name);
    const projected = orderAfterApply(
      snapshot,
      renamedTo,
      new Set(removed.map((status) => status.name)),
      created,
    );
    const reorder: Action = sameOrder(projected, order)
      ? {
          id: "statuses/reorder",
          phase: 3,
          kind: "status",
          op: "noop",
          name: "displayOrder",
          writeRequest: false,
        }
      : {
          id: "statuses/reorder",
          phase: 3,
          kind: "status",
          op: "reorder",
          name: "displayOrder",
          request: {
            method: "PATCH",
            path: `${statusesPath(key)}/updateDisplayOrder`,
            params: { statusId: resulting },
          },
          changes: [{ field: "displayOrder", before: projected, after: order }],
          writeRequest: true,
        };

    return [...creates, ...updates, ...deletes, reorder];
  },
};
