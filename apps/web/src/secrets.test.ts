import { describe, expect, it } from "vitest";

import {
  enteredEnvironment,
  environmentValue,
  revealApiKey,
  secretRevisions,
  setApiKey,
  setEnvironmentValue,
  subscribeSecrets,
} from "./secrets";

describe("API キーと環境変数の値の保持", () => {
  it("API キーは入力されるまで無い", () => {
    expect(secretRevisions().hasApiKey).toBe(false);
  });

  it("入力された API キーはそのまま送信に渡せる", () => {
    setApiKey("api-key");

    expect(revealApiKey()).toBe("api-key");
    expect(secretRevisions().hasApiKey).toBe(true);
  });

  /** 値そのものではなく「入っているか」だけを購読の返り値に載せる（§2.4）。 */
  it("打った API キーを消すと入力されていない扱いに戻る", () => {
    setApiKey("api-key");
    setApiKey("");

    expect(secretRevisions().hasApiKey).toBe(false);
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

describe("入力値の書き換えを知らせる", () => {
  it("API キーを書き換えると接続の版が進む", () => {
    const before = secretRevisions().credentials;

    setApiKey("another");

    expect(secretRevisions().credentials).toBe(before + 1);
  });

  /**
   * この版が進むことに検証のやり直しが乗っている（WU-16）。進まなければ、値を打ち直しても
   * 印が変わらず、古い検証結果が新しい値のものとして通る。
   */
  it("環境変数の値を書き換えると環境の版が進む", () => {
    const before = secretRevisions().environment;

    setEnvironmentValue("TOKEN", "v");

    expect(secretRevisions().environment).toBe(before + 1);
  });

  it("API キーを書き換えても環境の版は進まない", () => {
    const before = secretRevisions().environment;

    setApiKey("yet another");

    expect(secretRevisions().environment).toBe(before);
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
