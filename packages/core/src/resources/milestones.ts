import { type Action, type Change } from "../action";
import { type Milestone } from "../manifest";
import { type Reconciler } from "../reconciler";

type MilestoneFields = {
  name: string;
  description?: string;
  startDate?: string;
  releaseDueDate?: string;
};

export type ExistingMilestone = { id: number } & MilestoneFields;

export type MilestonesSnapshot = ExistingMilestone[];

const FIELDS = ["name", "description", "startDate", "releaseDueDate"] as const;

/** マイルストーンの取得は `versions`（core のデータモデル §4.1） */
const collectionPath = (projectKey: string) => `/api/v2/projects/${projectKey}/versions`;

const memberPath = (projectKey: string, id: number) => `${collectionPath(projectKey)}/${id}`;

/**
 * 応答の日付をそのまま持たない。時刻付きで返ってきた場合に、同じ日付でも
 * 毎回 update が出て NFR-4 が崩れる。マニフェストが表せるのは Y-1 の
 * `yyyy-MM-dd` だけなので、切り詰めても比較できる情報は減らない。
 */
const asDate = (value: string | null | undefined) => value?.slice(0, 10);

const asText = (value: string | null | undefined) => value ?? undefined;

const findExisting = (snapshot: MilestonesSnapshot, { name, oldname }: Milestone) =>
  snapshot.find((milestone) => milestone.name === name) ??
  snapshot.find((milestone) => milestone.name === oldname);

/**
 * マニフェストに書かれていないキーは比較にも送信にも載せない（K-3）。
 * 載せると、書いていない値をツールの既定で上書きすることになる。
 */
const changesOf = (desired: MilestoneFields, existing: ExistingMilestone | undefined): Change[] =>
  FIELDS.filter((field) => desired[field] !== undefined).map((field) => ({
    field,
    before: existing?.[field] ?? null,
    after: desired[field] ?? null,
  }));

const paramsOf = (changes: Change[]) =>
  Object.fromEntries(changes.map(({ field, after }) => [field, after]));

export const milestonesReconciler: Reconciler<Milestone[], MilestonesSnapshot> = {
  kind: "milestone",
  phase: 5,

  read: async ({ projectKey, snapshot, get }) => {
    if (!snapshot.project.exists) {
      return [];
    }

    const versions = (await get(collectionPath(projectKey))) as {
      id: number;
      name: string;
      description?: string | null;
      startDate?: string | null;
      releaseDueDate?: string | null;
    }[];

    return versions.map(({ id, name, description, startDate, releaseDueDate }) => ({
      id,
      name,
      description: asText(description),
      startDate: asDate(startDate),
      releaseDueDate: asDate(releaseDueDate),
    }));
  },

  plan: (desired, snapshot, { manifest }) => {
    const creates: Action[] = [];
    const updates: Action[] = [];
    const kept = new Set<number>();

    for (const milestone of desired) {
      const existing = findExisting(snapshot, milestone);
      const changes = changesOf(milestone, existing);

      if (existing === undefined) {
        creates.push({
          id: `milestones/create/${milestone.name}`,
          phase: 5,
          kind: "milestone",
          op: "create",
          name: milestone.name,
          request: {
            method: "POST",
            path: collectionPath(manifest.key),
            params: paramsOf(changes),
          },
          provides: [{ kind: "milestone", name: milestone.name }],
          changes,
          writeRequest: true,
        });

        continue;
      }

      kept.add(existing.id);

      if (changes.every(({ before, after }) => before === after)) {
        updates.push({
          id: `milestones/noop/${milestone.name}`,
          phase: 5,
          kind: "milestone",
          op: "noop",
          name: milestone.name,
          target: existing.id,
          writeRequest: false,
        });

        continue;
      }

      const renamed = existing.name !== milestone.name;

      updates.push({
        id: `milestones/update/${milestone.name}`,
        phase: 5,
        kind: "milestone",
        op: "update",
        name: milestone.name,
        target: existing.id,
        request: {
          method: "PATCH",
          path: memberPath(manifest.key, existing.id),
          params: paramsOf(changes),
        },
        ...(renamed ? { provides: [{ kind: "milestone" as const, name: milestone.name }] } : {}),
        changes,
        ...(renamed ? { notes: [{ type: "renamed" as const, from: existing.name }] } : {}),
        writeRequest: true,
      });
    }

    const deletes = snapshot
      .filter(({ id }) => !kept.has(id))
      .map((existing): Action => ({
        id: `milestones/delete/${existing.name}`,
        phase: 5,
        kind: "milestone",
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
