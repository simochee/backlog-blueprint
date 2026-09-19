import { type Action, type Change } from "../action";
import { type IssueType } from "../manifest";
import { embedRef } from "../ref";
import { type IdOrRef, type Ref, type Value } from "../value";
import { type Reconciler } from "../reconciler";

export type ExistingIssueType = {
  name: string;
  color: string;
  templateSummary?: string;
  templateDescription?: string;
  /** 新規プロジェクトの既定4件は `POST /projects` の成功後にしか ID が分からない（§4.1 / RF-1） */
  id?: number;
};

export type IssueTypesSnapshot = ExistingIssueType[];

type IssueTypeResponse = {
  id: number;
  name: string;
  color: string;
  templateSummary: string | null;
  templateDescription: string | null;
};

export const DEFAULT_ISSUE_TYPES: ExistingIssueType[] = [
  { name: "タスク", color: "#7ea800" },
  { name: "バグ", color: "#990000" },
  { name: "要望", color: "#ff9200" },
  { name: "その他", color: "#2779ca" },
];

const issueTypesPath = (key: string): string => `/api/v2/projects/${key}/issueTypes`;

const issueTypeRef = (name: string): Ref => ({ $ref: { kind: "issueType", name } });

const targetOf = (existing: ExistingIssueType): IdOrRef =>
  existing.id ?? issueTypeRef(existing.name);

const pathOf = (key: string, existing: ExistingIssueType): string =>
  `${issueTypesPath(key)}/${existing.id ?? embedRef(issueTypeRef(existing.name))}`;

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

const changesOf = (desired: IssueType, existing: ExistingIssueType): Change[] => {
  const before: Record<string, Value | undefined> = {
    name: existing.name,
    color: existing.color,
    templateSummary: existing.templateSummary,
    templateDescription: existing.templateDescription,
  };

  return Object.entries(declaredFields(desired))
    .filter(([field, after]) => before[field] !== after)
    .map(([field, after]) => ({ field, before: before[field] ?? null, after }));
};

export const issueTypesReconciler: Reconciler<IssueType[], IssueTypesSnapshot> = {
  kind: "issueType",
  phase: 2,

  async read(ctx) {
    if (!ctx.snapshot.project.exists) {
      return DEFAULT_ISSUE_TYPES;
    }

    const response = (await ctx.get(issueTypesPath(ctx.projectKey))) as IssueTypeResponse[];

    return response.map((issueType) => ({
      id: issueType.id,
      name: issueType.name,
      color: issueType.color,
      templateSummary: optional(issueType.templateSummary),
      templateDescription: optional(issueType.templateDescription),
    }));
  },

  plan(desired, snapshot, ctx) {
    const { key } = ctx.manifest;
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
      target: targetOf(existing),
      request: {
        method: "PATCH",
        path: pathOf(key, existing),
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
          changesOf(item, sameName).length === 0
            ? {
                id: `issueTypes/noop/${item.name}`,
                phase: 2,
                kind: "issueType",
                op: "noop",
                name: item.name,
                target: targetOf(sameName),
                writeRequest: false,
              }
            : updateAction(item, sameName),
        );

        continue;
      }

      const renamed = item.oldname === undefined ? undefined : byName.get(item.oldname);

      if (renamed !== undefined) {
        kept.add(renamed.name);
        updates.push(updateAction(item, renamed));

        continue;
      }

      creates.push({
        id: `issueTypes/create/${item.name}`,
        phase: 2,
        kind: "issueType",
        op: "create",
        name: item.name,
        request: { method: "POST", path: issueTypesPath(key), params: declaredFields(item) },
        provides: [{ kind: "issueType", name: item.name }],
        writeRequest: true,
      });
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
              target: targetOf(issueType),
              request: {
                method: "DELETE",
                path: pathOf(key, issueType),
                params: { substituteIssueTypeId: issueTypeRef(substitute.name) },
              },
              writeRequest: true,
            }));

    return [...creates, ...updates, ...deletes];
  },
};
