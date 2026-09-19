import { describe, expect, it } from "vitest";

import {
  enteredEnvironment,
  environmentValue,
  hasApiKey,
  revealApiKey,
  secretRevisions,
  setApiKey,
  setEnvironmentValue,
  subscribeSecrets,
} from "./secrets";

describe("秘匿値の保持", () => {
  it("API キーは入力されるまで無い", () => {
    expect(hasApiKey()).toBe(false);
  });

  it("入力された API キーはそのまま送信に渡せる", () => {
    setApiKey("api-key");

    expect(revealApiKey()).toBe("api-key");
    expect(hasApiKey()).toBe(true);
  });

  it("空欄の名前は環境に含めない", () => {
    setEnvironmentValue("FILLED", "value");
    setEnvironmentValue("EMPTY", "");

    expect(enteredEnvironment(["FILLED", "EMPTY"])).toStrictEqual({ FILLED: "value" });
  });

  it("マニフェストから消えた名前の値は環境に混ざらない", () => {
    setEnvironmentValue("REMOVED", "value");

    expect(enteredEnvironment([])).toStrictEqual({});
  });

  it("入力された値は入力欄に戻せる", () => {
    setEnvironmentValue("TOKEN", "t");

    expect(environmentValue("TOKEN")).toBe("t");
  });
});

describe("秘匿値の書き換えを知らせる", () => {
  it("API キーを書き換えると接続の版が進む", () => {
    const before = secretRevisions().credentials;

    setApiKey("another");

    expect(secretRevisions().credentials).toBe(before + 1);
  });

  it("環境変数の値を書き換えても接続の版は進まない", () => {
    const before = secretRevisions().credentials;

    setEnvironmentValue("TOKEN", "u");

    expect(secretRevisions().credentials).toBe(before);
  });

  it("書き換えは購読している画面に伝わる", () => {
    let notified = 0;
    const unsubscribe = subscribeSecrets(() => {
      notified += 1;
    });

    setApiKey("again");
    unsubscribe();
    setApiKey("once more");

    expect(notified).toBe(1);
  });
});
