import { type Action, type Change } from "../action";
import { type Status } from "../manifest";
import { type Reconciler } from "../reconciler";
import { type IdOrRef, type Ref, type Value } from "../value";

export type ExistingStatus = { id: number; name: string; color: string };

export type StatusesSnapshot = ExistingStatus[];

type StatusResponse = { id: number; name: string; color: string };

/**
 * 既定ステータスは全プロジェクト共通で ID 1〜4 の固定値であり、作成前でも分かる（§4.1）。
 * 表示名はスペースの言語設定で変わるので、既定かどうかの判定にだけ ID を使う（K-5）。
 */
const LAST_DEFAULT_STATUS_ID = 4;

/** 削除したステータスの課題の振替先は「未対応」で固定（§5.2） */
const SUBSTITUTE_STATUS_ID = 1;

export const DEFAULT_STATUSES: ExistingStatus[] = [
  { id: 1, name: "未対応", color: "#ed8077" },
  { id: 2, name: "処理中", color: "#4488c5" },
  { id: 3, name: "処理済み", color: "#5eb5a6" },
  { id: 4, name: "完了", color: "#b0be3c" },
];

const isDefaultStatus = ({ id }: ExistingStatus): boolean => id <= LAST_DEFAULT_STATUS_ID;

const statusesPath = (key: string): string => `/api/v2/projects/${key}/statuses`;

const statusRef = (name: string): Ref => ({ $ref: { kind: "status", name } });

const sameOrder = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((name, index) => name === right[index]);

const declaredFields = (desired: Status): Record<string, Value> => ({
  name: desired.name,
  ...(desired.color === undefined ? {} : { color: desired.color }),
});

const changesOf = (desired: Status, existing: ExistingStatus): Change[] => {
  const before: Record<string, Value> = { name: existing.name, color: existing.color };

  return Object.entries(declaredFields(desired))
    .filter(([field, after]) => before[field] !== after)
    .map(([field, after]) => ({ field, before: before[field] ?? null, after }));
};

/**
 * 新規カスタムは「完了」の直前に挿入される（実測）。末尾に付くと見なすと、
 * 記述順と一致しているのに並べ替えを打つ計画になり、L-5 と AC-8 の両方が崩れる。
 */
const orderAfterApply = (
  snapshot: StatusesSnapshot,
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
      return DEFAULT_STATUSES;
    }

    const response = (await ctx.get(statusesPath(ctx.projectKey))) as StatusResponse[];

    return response.map(({ id, name, color }) => ({ id, name, color }));
  },

  plan(desired, snapshot, ctx) {
    const { key } = ctx.manifest;
    const byName = new Map(snapshot.map((status) => [status.name, status]));
    const kept = new Set<string>();
    const renamedTo = new Map<string, string>();
    const created: string[] = [];
    const resulting: IdOrRef[] = [];
    const creates: Action[] = [];
    const updates: Action[] = [];

    for (const item of desired) {
      const sameName = byName.get(item.name);

      if (sameName !== undefined) {
        kept.add(sameName.name);
        resulting.push(sameName.id);

        const changes = isDefaultStatus(sameName) ? [] : changesOf(item, sameName);

        updates.push(
          changes.length === 0
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
                  params: declaredFields(item),
                },
                changes,
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
            params: declaredFields(item),
          },
          changes: changesOf(item, renamed),
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
        request: { method: "POST", path: statusesPath(key), params: declaredFields(item) },
        provides: [{ kind: "status", name: item.name }],
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
