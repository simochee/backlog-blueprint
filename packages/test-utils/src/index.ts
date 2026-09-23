/**
 * `packages/core` のテストはこのファイルを相対 path で読む。core の
 * devDependencies に `@backlog-blueprint/test-utils` を足すと、test-utils → core の
 * 依存と合わせてワークスペースの循環になり、turbo が
 * `Cyclic dependency detected` でタスクを組めなくなる（実測）。
 * 相対 import はその循環を作らないための形であって、書き忘れではない。
 */
import {
  DEFAULT_STATUSES_JA,
  normalizeManifest,
  type ExecuteContext,
  type HttpFailure,
  type Manifest,
  type ManifestInput,
  type PlanContext,
  type ReadContext,
  type ResolvedHttpRequest,
  type ResourceSnapshots,
  type Snapshot,
} from "@backlog-blueprint/core";

export const fixedSnapshot = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  executor: { id: 1, roleType: 1 },
  updateRateLimit: { limit: 150, remaining: 150, reset: 0 },
  project: { exists: true, id: 100, issueCount: 0 },
  ...overrides,
});

const HTTP_FAILURE = Symbol("HttpFailure");

/**
 * `get` は 404 でも `HttpFailure` を投げる（§7.0）。応答の表に書けるのは値だけなので、
 * 投げてほしい失敗であることを印で表す。
 */
export const httpFailure = (failure: HttpFailure): unknown => ({ [HTTP_FAILURE]: failure });

const thrownFailure = (response: unknown): HttpFailure | undefined =>
  typeof response === "object" && response !== null && HTTP_FAILURE in response
    ? (response as Record<symbol, HttpFailure>)[HTTP_FAILURE]
    : undefined;

/**
 * 表に無い path を `undefined` で返さない。返すとリソースの取得を書き忘れた実装が
 * テストを通ってしまい、固定値で組み立てる（B-3）意味が消える。
 */
export const fixedGet =
  (responses: Record<string, unknown>): ReadContext["get"] =>
  (path) => {
    if (!(path in responses)) {
      return Promise.reject(new Error(`No fixed response for GET ${path}`));
    }

    const response = responses[path];
    const failure = thrownFailure(response);

    return failure === undefined ? Promise.resolve(response) : Promise.reject(failure);
  };

export type RecordingGet = { get: ReadContext["get"]; requested: string[] };

/**
 * どこまで取得したかを残す。S5 が「権限が無ければスナップショットの取得を始めない」
 * ステージである以上、出た指摘だけでは中断の効き目を書き表せない。
 */
export const recordingGet = (responses: Record<string, unknown>): RecordingGet => {
  const requested: string[] = [];
  const get = fixedGet(responses);

  return {
    requested,
    get: (path) => {
      requested.push(path);

      return get(path);
    },
  };
};

export const fixedResourceSnapshots = (
  overrides: Partial<ResourceSnapshots> = {},
): ResourceSnapshots => ({
  projectKey: "PROJ_A",
  project: { exists: true, id: 100, name: "プロジェクトA", settings: {} },
  issueTypes: { source: "project", issueTypes: [] },
  statuses: { source: "project", statuses: [...DEFAULT_STATUSES_JA] },
  categories: [],
  milestones: [],
  customFields: { customFields: [], issueTypes: [] },
  access: { teams: [], members: [], administrators: [], spaceUsers: [], spaceTeams: [] },
  webhooks: [],
  ...overrides,
});

export const EXPORTABLE_WEBHOOK_URL = "https://hooks.example.test/T000/B000";

const EXPORTABLE_ISSUE_TYPES = [
  { id: 11, name: "タスク", color: "#7ea800" },
  { id: 12, name: "バグ", color: "#990000", templateSummary: "【不具合】" },
  { id: 13, name: "調査", color: "#2779ca" },
];

const REVIEWING_STATUS = { id: 5, name: "レビュー中", color: "#3b9dbd" };

/**
 * 既定ステータスを書き写さずに `DEFAULT_STATUSES_JA` へ差し込む。色は実測値であり、
 * 写しを持つと実測が直ったときに、この fixture だけが古い色のまま往復を主張する。
 */
const exportableStatuses = () =>
  DEFAULT_STATUSES_JA.flatMap((status) =>
    status.name === "処理済み" ? [REVIEWING_STATUS, status] : [status],
  );

/**
 * `fixedResourceSnapshots` の既定は空に寄せてあり、1つだけ差し替える plan の
 * テストのための形である。往復（EX-18）はどのリソースも埋まった姿から始めたいので、
 * 受け入れ（`apps/cli` の `MANIFEST`）を適用し終えた実状を別の関数として持つ。
 */
export const exportableResourceSnapshots = (
  overrides: Partial<ResourceSnapshots> = {},
): ResourceSnapshots => ({
  projectKey: "PROJ_A",
  project: {
    exists: true,
    id: 100,
    name: "プロジェクトA",
    settings: { textFormattingRule: "markdown", chartEnabled: true, useWiki: true },
  },
  issueTypes: { source: "project", issueTypes: [...EXPORTABLE_ISSUE_TYPES] },
  statuses: { source: "project", statuses: exportableStatuses() },
  categories: [
    { id: 61, name: "フロントエンド" },
    { id: 62, name: "バックエンド" },
  ],
  /**
   * 日付を API の返す時刻付きの形で持たない。`read()` が取り込みの時点で Y-1 の
   * `yyyy-MM-dd` に切り詰めるので、スナップショットに時刻が残ることは無い。
   * 時刻付きで置くと、reconciler が毎回 update を出す往復しない fixture になる。
   */
  milestones: [
    {
      id: 51,
      name: "v1.0.0",
      description: "初回リリース",
      startDate: "2026-10-01",
      releaseDueDate: "2026-12-31",
    },
  ],
  customFields: {
    customFields: [
      {
        id: 21,
        name: "影響範囲",
        typeId: 5,
        required: true,
        items: ["軽微", "重大"],
        applicableIssueTypes: [12],
      },
      { id: 22, name: "見積工数", typeId: 3, unit: "人日", min: 0, applicableIssueTypes: [] },
    ],
    issueTypes: EXPORTABLE_ISSUE_TYPES.map(({ id, name }) => ({ id, name })),
  },
  access: {
    teams: [{ id: 31, name: "開発チーム" }],
    members: [
      { id: 1, name: "山田 太郎" },
      { id: 2, name: "鈴木 花子" },
    ],
    administrators: [{ id: 2, name: "鈴木 花子" }],
    spaceUsers: [
      { id: 1, name: "山田 太郎", roleType: 1 },
      { id: 2, name: "鈴木 花子", roleType: 2 },
      { id: 3, name: "田中 一郎", roleType: 2 },
    ],
    spaceTeams: [{ id: 31, name: "開発チーム", members: [{ id: 3, name: "田中 一郎" }] }],
  },
  webhooks: [
    {
      id: 41,
      name: "Slack 通知",
      description: "課題の追加・更新を Slack に流す",
      hookUrl: EXPORTABLE_WEBHOOK_URL,
      allEvent: false,
      activityTypeIds: [1, 2],
    },
  ],
  ...overrides,
});

/**
 * フェーズ0と各 reconciler の `read()` が叩く GET（§4.1）を、課題0件の既存
 * プロジェクトの形でひととおり持つ。1つの取得だけを差し替えるテストが、
 * 残り全部を書き写さずに済むようにする。
 */
export const fixedSpaceResponses = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  "/api/v2/users/myself": { id: 1, userId: "yamada", roleType: 1 },
  "/api/v2/space": { spaceKey: "example", name: "Example Inc." },
  "/api/v2/rateLimit": { rateLimit: { update: { limit: 150, remaining: 150, reset: 0 } } },
  "/api/v2/projects/PROJ_A": { id: 100, name: "プロジェクトA" },
  "/api/v2/issues/count?projectId[]=100": { count: 0 },
  "/api/v2/projects/PROJ_A/issueTypes": [],
  "/api/v2/projects/PROJ_A/statuses": DEFAULT_STATUSES_JA,
  "/api/v2/projects/PROJ_A/categories": [],
  "/api/v2/projects/PROJ_A/versions": [],
  "/api/v2/projects/PROJ_A/customFields": [],
  "/api/v2/projects/PROJ_A/webhooks": [],
  "/api/v2/projects/PROJ_A/users?excludeGroupMembers=true": [],
  "/api/v2/projects/PROJ_A/teams": [],
  "/api/v2/projects/PROJ_A/administrators": [],
  "/api/v2/users": [{ id: 1, userId: "yamada", roleType: 1 }],
  "/api/v2/teams": [],
  ...overrides,
});

export type RecordingSend = {
  send: ExecuteContext["send"];
  sent: ResolvedHttpRequest[];
};

export const recordingSend = (
  respond: (request: ResolvedHttpRequest) => unknown = () => ({}),
): RecordingSend => {
  const sent: ResolvedHttpRequest[] = [];

  return {
    sent,
    send: (request) => {
      sent.push(request);

      return Promise.resolve(respond(request));
    },
  };
};

export const fixedManifest = (overrides: Partial<ManifestInput> = {}): Manifest =>
  normalizeManifest({ key: "PROJ_A", name: "プロジェクトA", ...overrides });

export const fixedReadContext = (
  responses: Record<string, unknown>,
  overrides: Partial<Omit<ReadContext, "get">> = {},
): ReadContext => ({
  projectKey: "PROJ_A",
  snapshot: fixedSnapshot(),
  get: fixedGet(responses),
  ...overrides,
});

export const fixedPlanContext = (overrides: Partial<PlanContext> = {}): PlanContext => ({
  manifest: fixedManifest(),
  snapshot: fixedSnapshot(),
  ...overrides,
});

export { mockBacklog, withoutWritePacing } from "./mock-backlog";
export type {
  MockBacklog,
  MockBacklogOptions,
  MockCategory,
  MockCustomField,
  MockFailure,
  MockFetch,
  MockIssueType,
  MockMethod,
  MockMilestone,
  MockProject,
  MockProjectInput,
  MockRequest,
  MockStatus,
  MockTeam,
  MockUser,
  MockWebhook,
} from "./mock-backlog";
