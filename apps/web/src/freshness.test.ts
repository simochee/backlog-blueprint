import { describe, expect, it } from "vitest";

import { connectionStamp, fresh, manifestStamp, planStamp } from "./freshness";

type Inputs = {
  sessionId: number;
  manifestText: string;
  environment: number;
};

const inputs = (overrides: Partial<Inputs> = {}): Inputs => ({
  sessionId: 1,
  manifestText: "key: PROJ_A\n",
  environment: 1,
  ...overrides,
});

const planOf = (values: Inputs): string =>
  planStamp(connectionStamp(values.sessionId), manifestStamp(values));

const PLAN = "a plan";

describe("算出済みの計画は入力の派生状態として読む", () => {
  it("入力が変わっていなければ算出済みの計画をそのまま使える", () => {
    const stamp = planOf(inputs());

    expect(fresh({ stamp, value: PLAN }, planOf(inputs()))).toBe(PLAN);
  });

  it("マニフェストを1文字でも変えた時点で計画は使えない", () => {
    const stamp = planOf(inputs());

    expect(fresh({ stamp, value: PLAN }, planOf(inputs({ manifestText: "key: PROJ_B\n" })))).toBe(
      undefined,
    );
  });

  it("環境変数の値を打ち直した時点で計画は使えない", () => {
    const stamp = planOf(inputs());

    expect(fresh({ stamp, value: PLAN }, planOf(inputs({ environment: 2 })))).toBe(undefined);
  });

  it("接続を差し替えた時点で計画は使えない", () => {
    const stamp = planOf(inputs());

    expect(fresh({ stamp, value: PLAN }, planOf(inputs({ sessionId: 2 })))).toBe(undefined);
  });
});

describe("接続の印は確立した接続だけに従う", () => {
  it("別の接続に差し替えると印が変わる", () => {
    const stamp = connectionStamp(1);

    expect(fresh({ stamp, value: PLAN }, connectionStamp(2))).toBe(undefined);
  });

  it("切断した後の印は、どの接続の印とも一致しない", () => {
    const stamp = connectionStamp(1);

    expect(fresh({ stamp, value: PLAN }, connectionStamp(undefined))).toBe(undefined);
  });

  it("同じ接続のままなら、マニフェストと環境変数の値を変えても印は保たれる", () => {
    expect(fresh({ stamp: connectionStamp(1), value: PLAN }, connectionStamp(1))).toBe(PLAN);
  });
});
