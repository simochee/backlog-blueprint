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

/**
 * 並べ替え API があるのはステータスだけなので、ステータスはここに入らない
 * （要件定義 §2.4）。この4つは既存の順序を保ち、新規が末尾に付く。
 */
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

/**
 * 既存の順序を保ち、新規は末尾に付く（要件定義 §2.4）。未作成のプロジェクトでは
 * 既存が無いので、生成される順がそのまま並びになる。
 */
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

/**
 * 適用後に実際どう並ぶか（plan の出力仕様 §1.4 / V-A15）。
 *
 * ステータスだけは記述順そのものになる。新規カスタムは「完了」の直前に挿入されるが、
 * フェーズ3の最後に `updateDisplayOrder` が記述順で並べ直すため（要件定義 §2.4 / §6）、
 * 適用が終わった時点の並びは常に記述順である。挿入位置の予測が要るのは
 * 「並べ直しが要るか」を決める側で、そこは statuses の reconciler が持っている。
 */
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
    statuses: manifest.statuses.map(({ name }) => name),
    categories: after("categories"),
    milestones: after("milestones"),
    customFields: after("customFields"),
  };
};
