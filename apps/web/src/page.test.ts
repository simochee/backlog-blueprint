import { describe, expect, it } from "vitest";

import { pageOf } from "./page";

describe("URL のハッシュが表すページ", () => {
  it("#/export は Export ページ", () => {
    expect(pageOf("#/export")).toBe("export");
  });

  it.each(["", "#", "#/"])("%j は Apply ページ", (hash) => {
    expect(pageOf(hash)).toBe("apply");
  });

  it("知らないハッシュは Apply ページに倒す", () => {
    expect(pageOf("#/plan")).toBe("apply");
  });
});
