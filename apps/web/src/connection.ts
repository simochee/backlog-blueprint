import {
  asRecord,
  authenticateExecutor,
  hasError,
  readUpdateRateLimit,
  requiredString,
  type Diagnostic,
  type RateLimit,
  type ReadContext,
} from "@backlog-blueprint/core";

const MYSELF_PATH = "/api/v2/users/myself";

export type Connection = { user: string; updateRateLimit: RateLimit };

export type ConnectionResult = { diagnostics: Diagnostic[]; connection?: Connection };

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
      user: requiredString(asRecord(responses.get(MYSELF_PATH)), "userId"),
      updateRateLimit: await readUpdateRateLimit(get),
    },
  };
};
