import { describe, expect, it } from "vitest";

import { apiKeyPageUrl } from "./space";

describe("API キーのページの案内", () => {
  it("スペースのドメインから個人設定の API ページを指す", () => {
    expect(apiKeyPageUrl("example.backlog.com")).toBe(
      "https://example.backlog.com/EditApiSettings.action",
    );
  });

  it("前後の空白は落とす", () => {
    expect(apiKeyPageUrl("  example.backlog.jp  ")).toBe(
      "https://example.backlog.jp/EditApiSettings.action",
    );
  });

  it.each([
    ["空", ""],
    ["打ちかけでドットが無い", "exa"],
    ["スキームが付いている", "https://example.backlog.com"],
    ["パスが付いている", "example.backlog.com/dashboard"],
    ["空白を含む", "example .backlog.com"],
    ["ドットで終わる", "example.backlog."],
  ])("ホスト名として成立していない入力には出さない（%s）", (_label, space) => {
    expect(apiKeyPageUrl(space)).toBeUndefined();
  });
});
