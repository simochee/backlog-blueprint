import { describe, expect, it } from "vitest";

import { initialOf } from "./avatar";

describe("アバターに描く頭文字", () => {
  it("名前の最初の1文字を大文字にする", () => {
    expect(initialOf("example Inc.")).toBe("E");
  });

  it("日本語の名前は最初の1文字をそのまま使う", () => {
    expect(initialOf("山田 太郎")).toBe("山");
  });

  it("サロゲートペアの文字も1文字として切り出す", () => {
    expect(initialOf("𠮷野家")).toBe("𠮷");
  });

  it("前後の空白は数えない", () => {
    expect(initialOf("  suzuki")).toBe("S");
  });

  it("名前が空なら ? を描く", () => {
    expect(initialOf(" ")).toBe("?");
  });
});
