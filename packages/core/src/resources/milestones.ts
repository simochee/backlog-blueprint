import { declaredOnly, differs, fieldChanges, paramsOf, type Action, type Change } from "../action";
import { type Milestone } from "../manifest";
import { type Reconciler } from "../reconciler";
import {
  asArrayOf,
  asRecord,
  optionalDate,
  optionalString,
  requiredNumber,
  requiredString,
} from "../api-response";

type MilestoneFields = {
  name: string;
  description?: string;
  startDate?: string;
  releaseDueDate?: string;
};

export type ExistingMilestone = { id: number } & MilestoneFields;

export type MilestonesSnapshot = ExistingMilestone[];

const FIELDS = ["name", "description", "startDate", "releaseDueDate"] as const;

/** path を `milestones` に直さない。API 上の名前は `versions` である（§4.1）。 */
const collectionPath = (projectKey: string) => `/api/v2/projects/${projectKey}/versions`;

const memberPath = (projectKey: string, id: number) => `${collectionPath(projectKey)}/${id}`;

const findExisting = (snapshot: MilestonesSnapshot, { name, oldname }: Milestone) =>
  snapshot.find((milestone) => milestone.name === name) ??
  snapshot.find((milestone) => milestone.name === oldname);

const changesOf = (desired: MilestoneFields, existing: ExistingMilestone | undefined): Change[] =>
  fieldChanges(
    declaredOnly(Object.fromEntries(FIELDS.map((field) => [field, desired[field]]))),
    existing ?? {},
  );

export const milestonesReconciler: Reconciler<Milestone[], MilestonesSnapshot> = {
  kind: "milestone",
  phase: 5,

  read: async ({ projectKey, snapshot, get }) => {
    if (!snapshot.project.exists) {
      return [];
    }

    return asArrayOf(await get(collectionPath(projectKey)), (item) => {
      const version = asRecord(item);

      return {
        id: requiredNumber(version, "id"),
        name: requiredString(version, "name"),
        description: optionalString(version, "description"),
        startDate: optionalDate(version, "startDate"),
        releaseDueDate: optionalDate(version, "releaseDueDate"),
      };
    });
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

      if (!differs(changes)) {
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
