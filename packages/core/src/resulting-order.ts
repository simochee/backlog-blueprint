import { type Action } from "./action";
import { type Manifest } from "./manifest";
import { type ResourceSnapshots } from "./plan";
import { type ResourceKind } from "./resource";

export type ResourceOrder = {
  issueTypes: string[];
  statuses: string[];
  categories: string[];
  milestones: string[];
  customFields: string[];
};

type OrderedResource = {
  kind: ResourceKind;
  declared: (manifest: Manifest) => string[];
  existing: (snapshots: ResourceSnapshots) => string[];
};

/** ステータスを入れない。並べ替え API があるのはステータスだけである（要件定義 §2.4）。 */
export const FIXED_ORDER_SECTIONS = [
  "issueTypes",
  "categories",
  "milestones",
  "customFields",
] as const;

export type FixedOrderSection = (typeof FIXED_ORDER_SECTIONS)[number];

const ORDERED_RESOURCES: Record<FixedOrderSection, OrderedResource> = {
  issueTypes: {
    kind: "issueType",
    declared: ({ issueTypes }) => issueTypes.map(({ name }) => name),
    existing: ({ issueTypes }) =>
      issueTypes.source === "project" ? issueTypes.issueTypes.map(({ name }) => name) : [],
  },
  categories: {
    kind: "category",
    declared: ({ categories }) => categories.map(({ name }) => name),
    existing: ({ categories }) => categories.map(({ name }) => name),
  },
  milestones: {
    kind: "milestone",
    declared: ({ milestones }) => milestones.map(({ name }) => name),
    existing: ({ milestones }) => milestones.map(({ name }) => name),
  },
  customFields: {
    kind: "customField",
    declared: ({ customFields }) => customFields.map(({ name }) => name),
    existing: ({ customFields }) => customFields.customFields.map(({ name }) => name),
  },
};

const renamedFrom = (action: Action): string | undefined =>
  action.notes?.find(({ type }) => type === "renamed")?.from;

const afterApply = (existing: string[], actions: Action[]): string[] => {
  const kept = new Map<string, string>();
  const created: string[] = [];

  for (const action of actions) {
    if (action.op === "create") {
      created.push(action.name);

      continue;
    }

    if (action.op === "update" || action.op === "noop") {
      kept.set(renamedFrom(action) ?? action.name, action.name);
    }
  }

  return [
    ...existing.filter((name) => kept.has(name)).map((name) => kept.get(name) ?? name),
    ...created,
  ];
};

export const declaredOrder = (manifest: Manifest): ResourceOrder => ({
  issueTypes: ORDERED_RESOURCES.issueTypes.declared(manifest),
  statuses: manifest.statuses.map(({ name }) => name),
  categories: ORDERED_RESOURCES.categories.declared(manifest),
  milestones: ORDERED_RESOURCES.milestones.declared(manifest),
  customFields: ORDERED_RESOURCES.customFields.declared(manifest),
});

export const resultingOrder = (
  manifest: Manifest,
  snapshots: ResourceSnapshots,
  actions: Action[],
): ResourceOrder => {
  const after = (section: FixedOrderSection): string[] => {
    const resource = ORDERED_RESOURCES[section];

    return afterApply(
      resource.existing(snapshots),
      actions.filter((action) => action.kind === resource.kind),
    );
  };

  return {
    issueTypes: after("issueTypes"),
    // 挿入位置を予測しない。フェーズ3の最後の `updateDisplayOrder` が記述順に並べ直す
    // （要件定義 §2.4 / §6）。予測が要るのは並べ直しの要否を決める statuses の reconciler だけ。
    statuses: manifest.statuses.map(({ name }) => name),
    categories: after("categories"),
    milestones: after("milestones"),
    customFields: after("customFields"),
  };
};
