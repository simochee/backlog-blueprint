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
  it("スペース管理者なら、スペース管理者として接続できる", async () => {
    const { connection, diagnostics } = await connect(get());

    expect(diagnostics).toStrictEqual([]);
    expect(connection?.user).toBe("yamada");
    expect(connection?.spaceAdministrator).toBe(true);
  });

  it("access に書く値として、ログイン ID とは別に数値のユーザー ID を持つ", async () => {
    const { connection } = await connect(
      get({ [MYSELF]: { id: 7, userId: "yamada", roleType: 1 } }),
    );

    expect(connection?.userId).toBe(7);
  });

  it("アイコンはスペースのものと、利用者の数値の id で引くものを取りに行く", async () => {
    const { connection } = await connect(
      get({ [MYSELF]: { id: 7, userId: "yamada", roleType: 1 } }),
    );

    expect(connection?.icons).toStrictEqual({
      space: "/api/v2/space/image",
      user: "/api/v2/users/7/icon",
    });
  });

  it("表示名があれば持ち、無ければ持たない", async () => {
    const named = await connect(
      get({ [MYSELF]: { id: 1, userId: "yamada", name: "山田 太郎", roleType: 1 } }),
    );
    const unnamed = await connect(get());

    expect(named.connection?.userName).toBe("山田 太郎");
    expect(unnamed.connection).not.toHaveProperty("userName");
  });

  it("自分のログイン ID が返らなくても接続でき、代わりに表示名を出す", async () => {
    const { connection, diagnostics } = await connect(
      get({ [MYSELF]: { id: 7, userId: null, name: "山田 太郎", roleType: 2 } }),
    );

    expect(diagnostics).toStrictEqual([]);
    expect(connection?.user).toBe("山田 太郎");
    expect(connection?.userId).toBe(7);
  });

  it("ログイン ID も表示名も返らなければ、数値のユーザー ID を出す", async () => {
    const { connection } = await connect(get({ [MYSELF]: { id: 7, userId: null, roleType: 2 } }));

    expect(connection?.user).toBe("7");
  });

  it("接続できると更新系レート制限の残量が分かる", async () => {
    const { connection } = await connect(get());

    expect(connection?.updateRateLimit).toStrictEqual({ limit: 150, remaining: 148, reset: 0 });
  });

  it("スペース管理者でなくても接続でき、スペース管理者ではないことが分かる", async () => {
    const { connection, diagnostics } = await connect(
      get({ [MYSELF]: { id: 2, userId: "suzuki", roleType: 2 } }),
    );

    expect(diagnostics).toStrictEqual([]);
    expect(connection?.user).toBe("suzuki");
    expect(connection?.spaceAdministrator).toBe(false);
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
