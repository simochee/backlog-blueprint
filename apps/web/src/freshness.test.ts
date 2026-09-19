import { describe, expect, it } from "vitest";

import { connectionStamp, fresh, planStamp, type Inputs } from "./freshness";

const inputs = (overrides: Partial<Inputs> = {}): Inputs => ({
  space: "example.backlog.com",
  manifestText: "key: PROJ_A\n",
  revisions: { credentials: 1, environment: 1 },
  ...overrides,
});

const typed = (revisions: Partial<Inputs["revisions"]>): Inputs =>
  inputs({ revisions: { credentials: 1, environment: 1, ...revisions } });

const PLAN = "a plan";

describe("算出済みの計画は入力の派生状態として読む", () => {
  it("入力が変わっていなければ算出済みの計画をそのまま使える", () => {
    const stamp = planStamp(inputs());

    expect(fresh({ stamp, value: PLAN }, planStamp(inputs()))).toBe(PLAN);
  });

  it("マニフェストを1文字でも変えた時点で計画は使えない", () => {
    const stamp = planStamp(inputs());

    expect(
      fresh({ stamp, value: PLAN }, planStamp(inputs({ manifestText: "key: PROJ_B\n" }))),
    ).toBe(undefined);
  });

  it("環境変数の値を打ち直した時点で計画は使えない", () => {
    const stamp = planStamp(inputs());

    expect(fresh({ stamp, value: PLAN }, planStamp(typed({ environment: 2 })))).toBe(undefined);
  });

  it("API キーを打ち直した時点で計画は使えない", () => {
    const stamp = planStamp(inputs());

    expect(fresh({ stamp, value: PLAN }, planStamp(typed({ credentials: 2 })))).toBe(undefined);
  });

  it("スペースを変えた時点で計画は使えない", () => {
    const stamp = planStamp(inputs());

    expect(fresh({ stamp, value: PLAN }, planStamp(inputs({ space: "other.backlog.com" })))).toBe(
      undefined,
    );
  });
});

describe("接続は接続情報だけに従う", () => {
  it("スペースを変えると接続し直しになる", () => {
    const stamp = connectionStamp(inputs());

    expect(
      fresh({ stamp, value: PLAN }, connectionStamp(inputs({ space: "other.backlog.com" }))),
    ).toBe(undefined);
  });

  it("API キーを打ち直すと接続し直しになる", () => {
    const stamp = connectionStamp(inputs());

    expect(fresh({ stamp, value: PLAN }, connectionStamp(typed({ credentials: 2 })))).toBe(
      undefined,
    );
  });

  it("マニフェストと環境変数の値を変えても接続は保たれる", () => {
    const stamp = connectionStamp(inputs());
    const edited = inputs({
      manifestText: "key: PROJ_B\n",
      revisions: { credentials: 1, environment: 9 },
    });

    expect(fresh({ stamp, value: PLAN }, connectionStamp(edited))).toBe(PLAN);
  });
});
