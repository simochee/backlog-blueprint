import { describe, expect, it } from "vitest";

import { pathFromInstancePath } from "./source-map";
import { parseManifestSyntax } from "./syntax-stage";

const MANIFEST = `key: PROJ_A
name: プロジェクトA
statuses:
  - name: 未対応
    color: #ea2c00
  - name: 完了
    color: null
`;

const parse = (text: string) => {
  const result = parseManifestSyntax(text);

  if (!result.parsed) {
    throw new Error(`parse failed: ${result.diagnostics.map(({ message }) => message).join(", ")}`);
  }

  return result.parsed;
};

describe("日付の読み方", () => {
  it("引用符を付けなかった日付も文字列として読まれる", () => {
    const { value } = parse("startDate: 2026-10-01\n");

    expect(value).toEqual({ startDate: "2026-10-01" });
  });

  it("引用符の有無で日付の型は変わらない", () => {
    expect(parse("startDate: 2026-10-01\n").value).toEqual(
      parse('startDate: "2026-10-01"\n').value,
    );
  });

  it("timestamp タグを明示しても日付は文字列のまま読まれる", () => {
    const { value } = parse("startDate: !!timestamp 2026-10-01\n");

    expect(value).toEqual({ startDate: "2026-10-01" });
  });

  it("YAML 1.1 を宣言しても日付は文字列のまま読まれる", () => {
    const { value } = parse("%YAML 1.1\n---\nstartDate: 2026-10-01\n");

    expect(value).toEqual({ startDate: "2026-10-01" });
  });
});

describe("値が書かれていないスカラー", () => {
  it("引用符の無い色はコメント扱いになり、値は null になる", () => {
    const { value } = parse(MANIFEST);

    expect(value).toMatchObject({ statuses: [{ color: null }, { color: null }] });
  });

  it("ソースに値が無い null と、null と書いた null は区別できる", () => {
    const { source } = parse(MANIFEST);

    expect(source.isEmptySource("statuses/0/color")).toBe(true);
    expect(source.isEmptySource("statuses/1/color")).toBe(false);
  });
});

describe("アンカーとエイリアス", () => {
  it("エイリアスは参照先の内容に展開されて読まれる", () => {
    const { value } = parse("base: &shared\n  name: 共通\nalias: *shared\n");

    expect(value).toEqual({ base: { name: "共通" }, alias: { name: "共通" } });
  });
});

describe("ドキュメントの数", () => {
  it("--- で区切った2つ目のドキュメントがあるとエラーになる", () => {
    const result = parseManifestSyntax("key: A\n---\nkey: B\n");

    expect(result.parsed).toBeUndefined();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ id: "Y-5", severity: "error", stage: "syntax", line: 2 }),
    ]);
  });
});

describe("パースの失敗", () => {
  it("位置付きで報告し、後続のステージに渡すドキュメントを返さない", () => {
    const result = parseManifestSyntax("key: PROJ_A\nstatuses: [1, 2\n");

    expect(result.parsed).toBeUndefined();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ id: "V-A23", severity: "error", stage: "syntax", line: 3 }),
    ]);
  });

  it("どう直すかを hint に書く", () => {
    const [diagnostic] = parseManifestSyntax("key: PROJ_A\nstatuses: [1, 2\n").diagnostics;

    expect(diagnostic?.hint).toContain("indentation");
  });
});

describe("path から引く位置", () => {
  it("キーの位置は行と列で引ける", () => {
    const { source } = parse(MANIFEST);

    expect(source.positionAt("key")).toEqual({ line: 1, column: 1 });
    expect(source.positionAt("statuses")).toEqual({ line: 3, column: 1 });
    expect(source.positionAt("statuses/0/color")).toEqual({ line: 5, column: 5 });
    expect(source.positionAt("statuses/1")).toEqual({ line: 6, column: 5 });
  });

  it("位置を持たない path は最も近い祖先の位置になる", () => {
    const { source } = parse(MANIFEST);

    expect(source.positionAt("statuses/0/oldname")).toEqual(source.positionAt("statuses/0"));
    expect(source.positionAt("issueTypes/0/name")).toEqual(source.positionAt("key"));
  });

  it("JSON Pointer の instancePath はスラッシュ区切りの path になる", () => {
    expect(pathFromInstancePath("/statuses/2/color")).toBe("statuses/2/color");
    expect(pathFromInstancePath("")).toBe("");
  });
});

describe("解決できないエイリアス", () => {
  it("アンカーの無い * 始まりの値は、例外ではなく診断になる", () => {
    const { diagnostics, parsed } = parseManifestSyntax(
      "key: PROJ_A\naccess:\n  members:\n    - *oNejJk6xEn\n",
    );

    expect(parsed).toBeUndefined();
    expect(diagnostics.map(({ id, severity }) => `${id}:${severity}`)).toEqual(["V-A23:error"]);
  });

  it("引用符で囲めば * 始まりの値もそのまま読まれる", () => {
    const { parsed } = parseManifestSyntax(
      'key: PROJ_A\naccess:\n  members:\n    - "*oNejJk6xEn"\n',
    );

    expect(parsed?.value).toEqual({ key: "PROJ_A", access: { members: ["*oNejJk6xEn"] } });
  });
});
