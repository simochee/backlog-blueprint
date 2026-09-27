import { asRecord, requiredNumber } from "../api-response";
import { type Diagnostic } from "../diagnostic";
import { type ReadContext } from "../reconciler";
import { type Snapshot } from "../snapshot";
import { failureDetail } from "./http-failure";
import { ROOT_PATH } from "./source-map";

const MYSELF_PATH = "/api/v2/users/myself";

/**
 * 1 以外の `roleType` を区別しない。V-B2 と V-B11 が問うのはスペース管理者か否かだけ
 * （API 制約「権限」）。
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
 * reconciler の `read()` と同じ流れに混ぜない（S5）。キーが無効なら以後の GET は
 * すべて無駄になる。
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
