import {
  asRecord,
  authenticateExecutor,
  hasError,
  optionalString,
  readUpdateRateLimit,
  requiredNumber,
  requiredString,
  SPACE_ADMINISTRATOR_ROLE_TYPE,
  type Diagnostic,
  type RateLimit,
  type ReadContext,
} from "@backlog-blueprint/core";

const MYSELF_PATH = "/api/v2/users/myself";

const SPACE_PATH = "/api/v2/space";

const SPACE_ICON_PATH = "/api/v2/space/image";

export type Connection = {
  /** 表示にだけ使う。`access` に書くのは `userId`（A-7） */
  user: string;
  userId: number;
  userName?: string;
  spaceAdministrator: boolean;
  space: string;
  icons: { space: string; user: string };
  updateRateLimit: RateLimit;
};

type ConnectionResult = { diagnostics: Diagnostic[]; connection?: Connection };

/**
 * 名前のためにもう一度 `GET /users/myself` を送らない。S5 は判定に要る id と roleType しか
 * 返さないので、認証ステージに渡す `get` の応答を覚えておいて読む。
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

  const myself = asRecord(responses.get(MYSELF_PATH));
  const userId = requiredNumber(myself, "id");
  const userName = optionalString(myself, "name");

  return {
    diagnostics: auth.diagnostics,
    connection: {
      user: optionalString(myself, "userId") || userName || String(userId),
      userId,
      ...(userName === undefined ? {} : { userName }),
      spaceAdministrator: requiredNumber(myself, "roleType") === SPACE_ADMINISTRATOR_ROLE_TYPE,
      space: requiredString(asRecord(await get(SPACE_PATH)), "name"),
      icons: {
        space: SPACE_ICON_PATH,
        user: `/api/v2/users/${userId}/icon`,
      },
      updateRateLimit: await readUpdateRateLimit(get),
    },
  };
};
