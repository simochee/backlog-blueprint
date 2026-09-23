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
  /** ログイン ID。本人が見慣れた値として表示にだけ使う（§2.2）。返らなければ表示名か ID */
  user: string;
  /** 数値のユーザー ID。`access` に書く値（A-7 / WU-35） */
  userId: number;
  /** 表示名。ユーザー ID をコピーするときのコメントにだけ使う（WU-35） */
  userName?: string;
  spaceAdministrator: boolean;
  space: string;
  /** アイコンを取る path（WU-35）。利用者のものは数値の id で引く */
  icons: { space: string; user: string };
  updateRateLimit: RateLimit;
};

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
