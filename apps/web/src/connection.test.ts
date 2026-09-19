import { type ReadContext } from "@backlog-blueprint/core";
import { fixedGet, fixedSpaceResponses, httpFailure } from "@backlog-blueprint/test-utils";
import { describe, expect, it } from "vitest";

import { connect } from "./connection";

const MYSELF = "/api/v2/users/myself";

const RATE_LIMIT = "/api/v2/rateLimit";

const get = (overrides: Record<string, unknown> = {}): ReadContext["get"] =>
  fixedGet(
    fixedSpaceResponses({
      [MYSELF]: { id: 1, userId: "yamada", roleType: 1 },
      [RATE_LIMIT]: { rateLimit: { update: { limit: 150, remaining: 148, reset: 0 } } },
      ...overrides,
    }),
  );

describe("接続の判定", () => {
  it("スペース管理者なら接続できる", async () => {
    const { connection, diagnostics } = await connect(get());

    expect(diagnostics).toStrictEqual([]);
    expect(connection?.user).toBe("yamada");
  });

  it("接続できると更新系レート制限の残量が分かる", async () => {
    const { connection } = await connect(get());

    expect(connection?.updateRateLimit).toStrictEqual({ limit: 150, remaining: 148 });
  });

  it("スペース管理者でなければ先へ進ませない", async () => {
    const { connection, diagnostics } = await connect(
      get({ [MYSELF]: { id: 2, userId: "suzuki", roleType: 2 } }),
    );

    expect(connection).toBe(undefined);
    expect(diagnostics.map(({ id }) => id)).toStrictEqual(["V-B2"]);
  });

  it("API キーが通らなければ先へ進ませない", async () => {
    const { connection, diagnostics } = await connect(
      get({ [MYSELF]: httpFailure({ status: 401, errors: [{ message: "Unauthorized" }] }) }),
    );

    expect(connection).toBe(undefined);
    expect(diagnostics.map(({ id }) => id)).toStrictEqual(["V-B1"]);
  });

  it("実行者は1度しか取得しない", async () => {
    const requested: string[] = [];
    const responses = get();

    await connect((path) => {
      requested.push(path);

      return responses(path);
    });

    expect(requested.filter((path) => path === MYSELF)).toHaveLength(1);
  });
});
