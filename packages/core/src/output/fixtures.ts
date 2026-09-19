import { type Action } from "../action";
import { type Diagnostic } from "../diagnostic";
import { Secret } from "../secret";
import { type PlanReport, type ValidateReport } from "./report";

/**
 * plan の出力仕様 §1.1 の通し例を固定値で組み立てる。テストは実 API も
 * reconciler も通さず、この `Action[]` を描画した結果だけを確かめる。
 */
export const walkthroughActions = (): Action[] => [
  {
    id: "project/create/PROJ_A",
    phase: 1,
    kind: "project",
    op: "create",
    name: "PROJ_A",
    request: {
      method: "POST",
      path: "/api/v2/projects",
      params: { key: "PROJ_A", name: "プロジェクトA" },
    },
    provides: [{ kind: "project", name: "PROJ_A" }],
    writeRequest: true,
  },
  {
    id: "project/refresh",
    phase: 1,
    kind: "project",
    op: "refresh",
    name: "PROJ_A",
    writeRequest: false,
  },
  {
    id: "issueTypes/noop/タスク",
    phase: 2,
    kind: "issueType",
    op: "noop",
    name: "タスク",
    writeRequest: false,
  },
  {
    id: "issueTypes/update/バグ",
    phase: 2,
    kind: "issueType",
    op: "update",
    name: "バグ",
    target: { $ref: { kind: "issueType", name: "バグ" } },
    changes: [
      { field: "name", before: "バグ", after: "バグ" },
      { field: "templateSummary", before: null, after: "【不具合】" },
    ],
    request: {
      method: "PATCH",
      path: "/api/v2/projects/PROJ_A/issueTypes/{$ref:issueType:バグ}",
      params: { name: "バグ", templateSummary: "【不具合】" },
    },
    writeRequest: true,
  },
  {
    id: "issueTypes/update/調査",
    phase: 2,
    kind: "issueType",
    op: "update",
    name: "調査",
    target: { $ref: { kind: "issueType", name: "その他" } },
    notes: [{ type: "renamed", from: "その他" }],
    changes: [
      { field: "name", before: "その他", after: "調査" },
      { field: "color", before: "#2779ca", after: "#2779ca" },
    ],
    request: {
      method: "PATCH",
      path: "/api/v2/projects/PROJ_A/issueTypes/{$ref:issueType:その他}",
      params: { name: "調査", color: "#2779ca" },
    },
    writeRequest: true,
  },
  {
    id: "issueTypes/delete/要望",
    phase: 2,
    kind: "issueType",
    op: "delete",
    name: "要望",
    target: { $ref: { kind: "issueType", name: "要望" } },
    request: {
      method: "DELETE",
      path: "/api/v2/projects/PROJ_A/issueTypes/{$ref:issueType:要望}",
      params: { substituteIssueTypeId: { $ref: { kind: "issueType", name: "タスク" } } },
    },
    writeRequest: true,
  },
  {
    id: "statuses/create/レビュー中",
    phase: 3,
    kind: "status",
    op: "create",
    name: "レビュー中",
    request: {
      method: "POST",
      path: "/api/v2/projects/PROJ_A/statuses",
      params: { name: "レビュー中", color: "#3b9dbd" },
    },
    provides: [{ kind: "status", name: "レビュー中" }],
    writeRequest: true,
  },
  {
    id: "statuses/reorder",
    phase: 3,
    kind: "status",
    op: "reorder",
    name: "displayOrder",
    changes: [
      {
        field: "displayOrder",
        before: ["未対応", "処理中", "処理済み", "完了"],
        after: ["未対応", "処理中", "レビュー中", "処理済み", "完了"],
      },
    ],
    request: {
      method: "PATCH",
      path: "/api/v2/projects/PROJ_A/statuses/updateDisplayOrder",
      params: { statusId: [1, 2, { $ref: { kind: "status", name: "レビュー中" } }, 3, 4] },
    },
    writeRequest: true,
  },
  {
    id: "projectTeams/create/開発チーム",
    phase: 7,
    kind: "projectTeam",
    op: "create",
    name: "開発チーム",
    request: {
      method: "POST",
      path: "/api/v2/projects/PROJ_A/teams",
      params: { teamId: 7 },
    },
    writeRequest: true,
  },
  {
    id: "projectMembers/create/suzuki",
    phase: 7,
    kind: "projectMember",
    op: "create",
    name: "suzuki",
    request: { method: "POST", path: "/api/v2/projects/PROJ_A/users", params: { userId: 9 } },
    writeRequest: true,
  },
  {
    id: "webhooks/create/Slack 通知",
    phase: 8,
    kind: "webhook",
    op: "create",
    name: "Slack 通知",
    request: {
      method: "POST",
      path: "/api/v2/projects/PROJ_A/webhooks",
      params: {
        name: "Slack 通知",
        hookUrl: new Secret("https://hooks.example.com/T000/B000"),
        allEvent: false,
        activityTypeIds: [1, 2],
      },
    },
    writeRequest: true,
  },
  ...["未対応", "処理中", "処理済み", "完了"].map((name): Action => ({
    id: `statuses/noop/${name}`,
    phase: 3,
    kind: "status",
    op: "noop",
    name,
    writeRequest: false,
  })),
];

export const walkthroughDiagnostics = (): Diagnostic[] => [
  {
    id: "V-A16",
    severity: "warning",
    stage: "plan",
    path: "access/members/0",
    message: '"suzuki" already belongs to team "開発チーム"',
    hint: "Remove it from access.members to save one write request.",
  },
];

export const walkthroughReport = (overrides: Partial<PlanReport> = {}): PlanReport => ({
  tool: { name: "@simochee/backlog-blueprint", version: "0.1.0" },
  space: "example.backlog.com",
  manifest: { path: "projects/PROJ_A.yaml" },
  project: { key: "PROJ_A", name: "プロジェクトA", exists: false },
  diagnostics: walkthroughDiagnostics(),
  actions: walkthroughActions(),
  resultingOrder: {
    issueTypes: ["タスク", "バグ", "調査"],
    statuses: ["未対応", "処理中", "レビュー中", "処理済み", "完了"],
    categories: [],
    milestones: [],
    customFields: [],
  },
  ...overrides,
});

export const walkthroughValidateReport = (
  overrides: Partial<ValidateReport> = {},
): ValidateReport => ({
  tool: { name: "@simochee/backlog-blueprint", version: "0.1.0" },
  manifest: { path: "projects/PROJ_A.yaml" },
  diagnostics: [],
  ...overrides,
});
