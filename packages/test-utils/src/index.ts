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

/**
 * フェーズ0と各 reconciler の `read()` が叩く GET（§4.1）を、課題0件の既存
 * プロジェクトの形でひととおり持つ。1つの取得だけを差し替えるテストが、
 * 残り全部を書き写さずに済むようにする。
 */
export const fixedSpaceResponses = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  "/api/v2/users/myself": { id: 1, userId: "yamada", roleType: 1 },
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
  "/api/v2/users": [{ id: 1, userId: "yamada" }],
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
  isSecret: () => false,
  ...overrides,
});

/**
 * 展開された path を集合で受ける。`${ENV}` 由来かどうかを述語で書かせると、
 * テストごとに「どの path が秘匿か」の表現が変わり、S2 が返す `expandedPaths`
 * （E-6）と同じ形で書けているかが読み取れなくなる。
 */
export const secretPaths = (...paths: string[]): PlanContext["isSecret"] => {
  const expanded = new Set(paths);

  return (path) => expanded.has(path);
};

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
