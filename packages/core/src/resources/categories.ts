import { type Action, type Change } from "../action";
import { type Category } from "../manifest";
import { type Reconciler } from "../reconciler";
import { sealChanges, sealFields, sealer } from "../secret";

export type ExistingCategory = {
  id: number;
  name: string;
};

export type CategoriesSnapshot = ExistingCategory[];

const collectionPath = (projectKey: string) => `/api/v2/projects/${projectKey}/categories`;

const memberPath = (projectKey: string, id: number) => `${collectionPath(projectKey)}/${id}`;

const basePath = (index: number) => `categories/${index}`;

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

    const categories = (await get(collectionPath(projectKey))) as ExistingCategory[];

    return categories.map(({ id, name }) => ({ id, name }));
  },

  plan: (desired, snapshot, { manifest, isSecret }) => {
    const seal = sealer(isSecret);
    const creates: Action[] = [];
    const updates: Action[] = [];
    const kept = new Set<number>();

    for (const [index, category] of desired.entries()) {
      const existing = findExisting(snapshot, category);
      const fields = sealFields({ name: category.name }, basePath(index), seal);

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
          changes: sealChanges(changesOf(category.name, undefined), basePath(index), seal),
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
        changes: sealChanges(changesOf(category.name, existing), basePath(index), seal),
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
