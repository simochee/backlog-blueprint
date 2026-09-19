import {
  type ExecuteContext,
  type ReadContext,
  type ResolvedHttpRequest,
  type Snapshot,
} from "@backlog-blueprint/core";

export const fixedSnapshot = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  executor: { id: 1, roleType: 1 },
  updateRateLimit: { limit: 150, remaining: 150, reset: 0 },
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
