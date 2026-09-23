import { asRecord, requiredNumber } from "../api-response";
import { type Diagnostic } from "../diagnostic";
import { type ReadContext } from "../reconciler";
import { type Snapshot } from "../snapshot";
import { failureDetail } from "./http-failure";
import { ROOT_PATH } from "./source-map";

const MYSELF_PATH = "/api/v2/users/myself";

/**
 * `roleType: 1` がスペース管理者（API 制約「権限」）。1 以外の値も実在するが、
 * V-B2 と V-B11 が問うのはスペース管理者か否かだけなので、判定は「1 か、それ以外か」でよい。
 */
export const SPACE_ADMINISTRATOR_ROLE_TYPE = 1;

export type AuthStageResult = { diagnostics: Diagnostic[]; executor?: Snapshot["executor"] };

const authDiagnostic = (id: string, message: string, hint: string): Diagnostic => ({
  id,
  severity: "error",
  stage: "auth",
  path: ROOT_PATH,
  message,
  hint,
});

/**
 * スナップショットの取得より前に、単独のステージとして実行者を確かめる（S5）。
 * キーが無効と分かった時点で以後のすべての GET が無駄になるので、reconciler の
 * `read()` と同じ流れに混ぜない。
 */
export const authenticateExecutor = async (get: ReadContext["get"]): Promise<AuthStageResult> => {
  let response: unknown;

  try {
    response = await get(MYSELF_PATH);
  } catch (error) {
    return {
      diagnostics: [
        authDiagnostic(
          "V-B1",
          `GET ${MYSELF_PATH} failed: ${failureDetail(error)}`,
          "check the API key and the space domain",
        ),
      ],
    };
  }

  const myself = asRecord(response);

  return {
    diagnostics: [],
    executor: { id: requiredNumber(myself, "id"), roleType: requiredNumber(myself, "roleType") },
  };
};
