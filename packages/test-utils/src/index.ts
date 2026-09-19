import {
  normalizeManifest,
  type ExecuteContext,
  type Manifest,
  type ManifestInput,
  type PlanContext,
  type ReadContext,
  type ResolvedHttpRequest,
  type Snapshot,
} from "@backlog-blueprint/core";

export const fixedSnapshot = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  executor: { id: 1, roleType: 1 },
  updateRateLimit: { limit: 150, remaining: 150, reset: 0 },
  space: { lang: "ja" },
  project: { exists: true, id: 100, issueCount: 0 },
  ...overrides,
});

/**
 * 表に無い path を `undefined` で返さない。返すとリソースの取得を書き忘れた実装が
 * テストを通ってしまい、固定値で組み立てる（B-3）意味が消える。
 */
export const fixedGet =
  (responses: Record<string, unknown>): ReadContext["get"] =>
  (path) =>
    path in responses
      ? Promise.resolve(responses[path])
      : Promise.reject(new Error(`No fixed response for GET ${path}`));

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
