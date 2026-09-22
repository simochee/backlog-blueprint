import { type Action, type Change } from "../action";
import { type Category } from "../manifest";
import { type Reconciler } from "../reconciler";
import { asArrayOf, asRecord, requiredNumber, requiredString } from "../api-response";

export type ExistingCategory = {
  id: number;
  name: string;
};

export type CategoriesSnapshot = ExistingCategory[];

const collectionPath = (projectKey: string) => `/api/v2/projects/${projectKey}/categories`;

const memberPath = (projectKey: string, id: number) => `${collectionPath(projectKey)}/${id}`;

const findExisting = (snapshot: CategoriesSnapshot, { name, oldname }: Category) =>
  snapshot.find((category) => category.name === name) ??
  snapshot.find((category) => category.name === oldname);

const changesOf = (name: string, existing: ExistingCategory | undefined): Change[] => [
  { field: "name", before: existing?.name ?? null, after: name },
];

export const categoriesReconciler: Reconciler<Category[], CategoriesSnapshot> = {
  kind: "category",
  phase: 4,

  read: async ({ projectKey, snapshot, get }) => {
    if (!snapshot.project.exists) {
      return [];
    }

    return asArrayOf(await get(collectionPath(projectKey)), (item) => {
      const category = asRecord(item);

      return { id: requiredNumber(category, "id"), name: requiredString(category, "name") };
    });
  },

  plan: (desired, snapshot, { manifest }) => {
    const creates: Action[] = [];
    const updates: Action[] = [];
    const kept = new Set<number>();

    for (const category of desired) {
      const existing = findExisting(snapshot, category);
      const fields = { name: category.name };

      if (existing === undefined) {
        creates.push({
          id: `categories/create/${category.name}`,
          phase: 4,
          kind: "category",
          op: "create",
          name: category.name,
          request: {
            method: "POST",
            path: collectionPath(manifest.key),
            params: fields,
          },
          provides: [{ kind: "category", name: category.name }],
          changes: changesOf(category.name, undefined),
          writeRequest: true,
        });

        continue;
      }

      kept.add(existing.id);

      if (existing.name === category.name) {
        updates.push({
          id: `categories/noop/${category.name}`,
          phase: 4,
          kind: "category",
          op: "noop",
          name: category.name,
          target: existing.id,
          writeRequest: false,
        });

        continue;
      }

      updates.push({
        id: `categories/update/${category.name}`,
        phase: 4,
        kind: "category",
        op: "update",
        name: category.name,
        target: existing.id,
        request: {
          method: "PATCH",
          path: memberPath(manifest.key, existing.id),
          params: fields,
        },
        provides: [{ kind: "category", name: category.name }],
        changes: changesOf(category.name, existing),
        notes: [{ type: "renamed", from: existing.name }],
        writeRequest: true,
      });
    }

    const deletes = snapshot
      .filter(({ id }) => !kept.has(id))
      .map((existing): Action => ({
        id: `categories/delete/${existing.name}`,
        phase: 4,
        kind: "category",
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
