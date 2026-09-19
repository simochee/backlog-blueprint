import { describe, expect, it } from "vitest";

import { fixedGet, httpFailure } from "../../../test-utils/src/index";
import { authenticateExecutor } from "./auth-stage";

const myself = (response: unknown) => fixedGet({ "/api/v2/users/myself": response });

describe("接続と権限（S5）", () => {
  it("一般ユーザーの API キーでは V-B2 で中断する", async () => {
    const { diagnostics } = await authenticateExecutor(myself({ id: 7, roleType: 2 }));

    expect(diagnostics).toMatchObject([{ id: "V-B2", severity: "error", stage: "auth" }]);
  });

  it("スペース管理者の API キーなら実行者を返し、指摘を出さない", async () => {
    const result = await authenticateExecutor(myself({ id: 7, roleType: 1 }));

    expect(result).toEqual({ diagnostics: [], executor: { id: 7, roleType: 1 } });
  });

  it("API キーが無効なら V-B1 で中断する", async () => {
    const { diagnostics } = await authenticateExecutor(
      myself(httpFailure({ status: 401, errors: [{ message: "Invalid api key" }] })),
    );

    expect(diagnostics).toMatchObject([{ id: "V-B1", severity: "error", stage: "auth" }]);
  });

  it("接続に失敗した理由をそのまま伝える", async () => {
    const { diagnostics } = await authenticateExecutor(
      myself(httpFailure({ status: 401, errors: [{ message: "Invalid api key" }] })),
    );

    expect(diagnostics[0]?.message).toContain("Invalid api key");
  });

  it("権限を確かめられなかったときは実行者を返さない", async () => {
    const { executor } = await authenticateExecutor(
      myself(httpFailure({ errors: [{ message: "Network error" }] })),
    );

    expect(executor).toBeUndefined();
  });
});
