import { describe, expect, it } from "vitest";

import { Secret, sealer } from "./secret";

describe("${ENV} から展開された値", () => {
  it("文字列化するとマスクされる", () => {
    const value = new Secret("https://hooks.example.test/T000/B000");

    expect(String(value)).toBe("***");
  });

  it("文字列に連結してもマスクされる", () => {
    const value = new Secret("https://hooks.example.test/T000/B000");

    expect(`hookUrl ${value}`).toBe("hookUrl ***");
  });

  it("JSON 化しても実値が現れない", () => {
    const value = new Secret("https://hooks.example.test/T000/B000");

    expect(JSON.stringify(value)).toBe('"***"');
  });

  it("リクエストのパラメータに埋め込んだまま JSON 化しても実値が現れない", () => {
    const params = {
      name: "Slack 通知",
      hookUrl: new Secret("https://hooks.example.test/T000/B000"),
    };

    expect(JSON.stringify({ params })).toBe('{"params":{"name":"Slack 通知","hookUrl":"***"}}');
  });

  it("プロパティを列挙しても実値が現れない", () => {
    const value = new Secret("https://hooks.example.test/T000/B000");

    expect(Object.keys(value)).toEqual([]);
    expect(JSON.stringify(Object.entries(value))).toBe("[]");
  });

  it("実値を取り出せるのは reveal を呼んだときだけ", () => {
    const value = new Secret("https://hooks.example.test/T000/B000");

    expect(value.reveal()).toBe("https://hooks.example.test/T000/B000");
  });
});

describe("同定名の扱い（E-7）", () => {
  const seal = sealer(() => true);

  it("リソースの名前は ${ENV} 由来でも平文のまま残る", () => {
    expect(seal("categories/0/name", "共通")).toBe("共通");
  });

  it("oldname も平文のまま残る", () => {
    expect(seal("categories/0/oldname", "きょうつう")).toBe("きょうつう");
  });

  it("プロジェクトキーも平文のまま残る", () => {
    expect(seal("key", "PROJ_A")).toBe("PROJ_A");
  });

  it("プロジェクト名は同定名ではないのでマスクされる", () => {
    expect(seal("name", "プロジェクトA")).toBeInstanceOf(Secret);
  });

  it("同定名ではない文字列はマスクされる", () => {
    expect(seal("webhooks/0/hookUrl", "https://hooks.example.test/T000/B000")).toBeInstanceOf(
      Secret,
    );
    expect(seal("issueTypes/0/templateDescription", "手順")).toBeInstanceOf(Secret);
  });

  it("配列の要素は添字付きの path で判定する", () => {
    expect(seal("customFields/0/items", ["本番", "検証"])).toEqual([
      expect.any(Secret),
      expect.any(Secret),
    ]);
  });
});
