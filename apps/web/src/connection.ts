import {
  authenticateExecutor,
  hasError,
  type Diagnostic,
  type ReadContext,
} from "@backlog-blueprint/core";

const MYSELF_PATH = "/api/v2/users/myself";

const RATE_LIMIT_PATH = "/api/v2/rateLimit";

export type UpdateRateLimit = { limit: number; remaining: number };

export type Connection = { user: string; updateRateLimit: UpdateRateLimit };

export type ConnectionResult = { diagnostics: Diagnostic[]; connection?: Connection };

/**
 * 応答の形を `as` で名乗らせない（core の api-response と同じ理由）。読めない応答は
 * ここで落とし、呼び出し側が失敗として描く。
 */
const fail = (detail: string): never => {
  throw new TypeError(`Unexpected Backlog API response: ${detail}`);
};

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail("expected an object");

const numberField = (source: Record<string, unknown>, field: string): number => {
  const value = source[field];

  return typeof value === "number" ? value : fail(`"${field}" must be a number`);
};

const stringField = (source: Record<string, unknown>, field: string): string => {
  const value = source[field];

  return typeof value === "string" ? value : fail(`"${field}" must be a string`);
};

/**
 * 残量はヘッダではなく本文から読む（X-3 / FR-7.6）。ブラウザは
 * `access-control-expose-headers` が無くヘッダを読めないが、core が常に本文を使うので
 * Web 側に分岐は要らない。
 */
const updateRateLimitOf = (body: unknown): UpdateRateLimit => {
  const update = record(record(record(body)["rateLimit"])["update"]);

  return { limit: numberField(update, "limit"), remaining: numberField(update, "remaining") };
};

/**
 * `get` の応答を覚えてから認証ステージに渡す。S5 が返すのは判定に要る id と roleType
 * だけで、画面に出す名前は返さない。名前のためにもう一度 `GET /users/myself` を送る形に
 * すると、同じ応答を2度取りに行くことになる。
 */
export const connect = async (get: ReadContext["get"]): Promise<ConnectionResult> => {
  const responses = new Map<string, unknown>();
  const remembering: ReadContext["get"] = async (path) => {
    const response = await get(path);

    responses.set(path, response);

    return response;
  };
  const auth = await authenticateExecutor(remembering);

  if (hasError(auth.diagnostics)) {
    return { diagnostics: auth.diagnostics };
  }

  return {
    diagnostics: auth.diagnostics,
    connection: {
      user: stringField(record(responses.get(MYSELF_PATH)), "userId"),
      updateRateLimit: updateRateLimitOf(await get(RATE_LIMIT_PATH)),
    },
  };
};
