import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { type Diagnostic } from "../diagnostic";
import { ManifestSchema } from "../manifest";
import { validateSchema } from "./schema-stage";
import { type SourceMap } from "./source-map";

const minimal = { key: "PROJ_A", name: "プロジェクトA" };

/**
 * 位置と「ソースに値が書かれていないか」は S1 が読み取る（DG-5 / Y-3）。
 * S3 のテストは S1 を走らせずに、その読み取り結果を固定値で差し替える。
 */
const sourceMap = (overrides: Partial<SourceMap> = {}): SourceMap => ({
  positionAt: () => ({ line: 1, column: 1 }),
  isEmptySource: () => false,
  ...overrides,
});

const unquoted = (...paths: string[]): SourceMap =>
  sourceMap({ isEmptySource: (path) => paths.includes(path) });

const idsOf = (manifest: unknown): string[] => validateSchema(manifest).map(({ id }) => id);

const only = (manifest: unknown): Diagnostic => {
  const diagnostics = validateSchema(manifest);

  expect(diagnostics).toHaveLength(1);

  return diagnostics[0] as Diagnostic;
};

const statuses = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ name: `状態${index}` }));

describe("スキーマ検証の対象", () => {
  it("要件どおりに書かれたマニフェストは何も指摘されない", () => {
    expect(
      validateSchema({
        ...minimal,
        settings: { textFormattingRule: "markdown" },
        issueTypes: [{ name: "バグ", color: "#990000" }],
        statuses: [{ name: "未対応" }, { name: "処理中", color: "#4caf93" }],
        customFields: [{ name: "影響範囲", type: "singleList", items: ["大", "小"] }],
        access: { members: [1, 2] },
      }),
    ).toEqual([]);
  });

  it("指摘はすべてエラーであり、スキーマのステージとして返る", () => {
    const diagnostic = only({ ...minimal, key: "proj_a" });

    expect(diagnostic.severity).toBe("error");
    expect(diagnostic.stage).toBe("schema");
  });
});

describe("要件定義の ID への割り当て", () => {
  it("未知のキーは V-A1 として報告される", () => {
    expect(only({ ...minimal, unknownKey: "value" })).toMatchObject({
      id: "V-A1",
      path: "unknownKey",
    });
    expect(only({ ...minimal, settings: { useSomething: true } })).toMatchObject({
      id: "V-A1",
      path: "settings/useSomething",
    });
  });

  it("key と name が無ければ V-A2 として報告される", () => {
    expect(validateSchema({})).toMatchObject([
      { id: "V-A2", path: "key" },
      { id: "V-A2", path: "name" },
    ]);
  });

  it("プロジェクトキーが小文字を含むと V-A3 として報告される", () => {
    expect(only({ ...minimal, key: "proj_a" })).toMatchObject({ id: "V-A3", path: "key" });
  });

  it("ステータスが13件あると V-A7 として報告される", () => {
    expect(only({ ...minimal, statuses: statuses(13) })).toMatchObject({
      id: "V-A7",
      path: "statuses",
    });
    expect(validateSchema({ ...minimal, statuses: statuses(12) })).toEqual([]);
  });

  it("issueTypes が空配列だと V-A9 として報告される", () => {
    expect(only({ ...minimal, issueTypes: [] })).toMatchObject({
      id: "V-A9",
      path: "issueTypes",
    });
  });

  it("リスト型のカスタム属性に items が無いと V-A11 として報告される", () => {
    expect(
      only({ ...minimal, customFields: [{ name: "影響範囲", type: "singleList" }] }),
    ).toMatchObject({ id: "V-A11", path: "customFields/0/items" });
  });

  it("カスタム属性の型に合わないキーも V-A11 として報告される", () => {
    expect(
      only({ ...minimal, customFields: [{ name: "見積", type: "number", items: ["大"] }] }),
    ).toMatchObject({ id: "V-A11", path: "customFields/0/items" });
  });

  it("access の各リスト内の重複は V-A13 として報告される", () => {
    expect(only({ ...minimal, access: { members: [1, 1] } })).toMatchObject({
      id: "V-A13",
      path: "access/members",
    });
  });

  it("access の個人にログイン ID を書くとスキーマで止まる（A-7）", () => {
    expect(only({ ...minimal, access: { members: ["yamada"] } })).toMatchObject({
      severity: "error",
      path: "access/members/0",
    });
  });

  it("ステータスの色がパレットの外にあると V-A8 として報告される", () => {
    expect(
      only({ ...minimal, statuses: [{ name: "レビュー中", color: "#000000" }] }),
    ).toMatchObject({ id: "V-A8", path: "statuses/0/color" });
  });

  it("パレット内のステータスの色は何も指摘されない", () => {
    expect(idsOf({ ...minimal, statuses: [{ name: "レビュー中", color: "#3b9dbd" }] })).toEqual([]);
  });

  it("既定ステータスに既定の色を書いた場合も V-A8 になる", () => {
    expect(idsOf({ ...minimal, statuses: [{ name: "未対応", color: "#ed8077" }] })).toEqual([
      "V-A8",
    ]);
  });

  it("課題種別の色は個別の ID を持たないので V-A21 のままになる", () => {
    expect(only({ ...minimal, issueTypes: [{ name: "バグ", color: "#000000" }] })).toMatchObject({
      id: "V-A21",
      path: "issueTypes/0/color",
    });
  });

  it("個別の ID を持たない型・制約の違反は V-A21 として報告される", () => {
    expect(only({ ...minimal, settings: { textFormattingRule: "html" } })).toMatchObject({
      id: "V-A21",
      path: "settings/textFormattingRule",
    });
    expect(
      only({ ...minimal, milestones: [{ name: "v1", startDate: "2026/10/01" }] }),
    ).toMatchObject({ id: "V-A21", path: "milestones/0/startDate" });
  });
});

describe("メッセージ", () => {
  it("色の引用符を忘れた場合は、型の説明ではなく引用符を促す（V-A18）", () => {
    const [diagnostic] = validateSchema(
      { ...minimal, statuses: [{ name: "完了", color: null }] },
      { source: unquoted("statuses/0/color") },
    );

    expect(diagnostic).toMatchObject({ id: "V-A18", path: "statuses/0/color" });
    expect(diagnostic?.message).not.toContain("string");
    expect(diagnostic?.hint).toContain("quote");
  });

  it("課題種別の色でも同じ指摘になる", () => {
    expect(
      validateSchema(
        { ...minimal, issueTypes: [{ name: "バグ", color: null }] },
        { source: unquoted("issueTypes/0/color") },
      ),
    ).toMatchObject([{ id: "V-A18", path: "issueTypes/0/color" }]);
  });

  it("color: null と明示的に書いた場合は引用符の話をしない", () => {
    const [diagnostic] = validateSchema(
      { ...minimal, statuses: [{ name: "完了", color: null }] },
      { source: sourceMap() },
    );

    expect(diagnostic?.id).toBe("V-A21");
    expect(diagnostic?.hint).not.toContain("quote");
  });

  it("日付のパターン違反は正規表現ではなく書き方で説明する", () => {
    expect(only({ ...minimal, milestones: [{ name: "v1", startDate: "2026/10/01" }] }).hint).toBe(
      "use the yyyy-MM-dd format",
    );
  });

  it("イベント名の打ち間違いには、書ける3つの形を示す", () => {
    const diagnostic = only({
      ...minimal,
      webhooks: [{ name: "通知", hookUrl: "https://example.test", events: ["issueCreatd"] }],
    });

    expect(diagnostic.hint).toContain("issueCreated");
    expect(diagnostic.hint).toContain("all");
  });

  it("利用者が付けた名前はそのまま埋め込まれる", () => {
    const diagnostic = only({ ...minimal, customFields: [{ name: "影響範囲", type: "radio" }] });

    expect(diagnostic.message).toContain("影響範囲");
  });

  it("どう直すかを hint に書く", () => {
    expect(only({ ...minimal, key: "proj_a" }).hint).toBe(
      "write the project key with uppercase letters, digits and underscores only",
    );
    expect(only({ ...minimal, settings: { textFormattingRule: "html" } }).hint).toBe(
      'use one of: "backlog", "markdown"',
    );
  });
});

describe("列挙と位置", () => {
  it("違反が複数あるとき、1件目で止まらず全件が返る", () => {
    expect(
      idsOf({
        key: "proj_a",
        name: "プロジェクトA",
        unknownKey: 1,
        issueTypes: [],
        statuses: statuses(13),
        access: { teams: [31, 31] },
        settings: { textFormattingRule: "html" },
      }),
    ).toEqual(["V-A1", "V-A3", "V-A21", "V-A9", "V-A7", "V-A13"]);
  });

  it("path は JSON Pointer 風のスラッシュ区切りで、配列は添字になる", () => {
    expect(
      only({ ...minimal, statuses: [{ name: "a" }, { name: "b" }, { name: "c", color: "#fff" }] }),
    ).toMatchObject({ path: "statuses/2/color" });
  });

  it("行と列は S1 が読み取った位置から受け取る", () => {
    expect(
      validateSchema(
        { ...minimal, key: "proj_a" },
        { source: sourceMap({ positionAt: () => ({ line: 2, column: 6 }) }) },
      ),
    ).toMatchObject([{ path: "key", line: 2, column: 6 }]);
  });

  it("行と列を渡さなければ位置を持たない", () => {
    expect(only({ ...minimal, key: "proj_a" })).not.toHaveProperty("line");
  });
});

describe("配布する JSON Schema", () => {
  it("Ajv 2020 の strict モードで警告なくコンパイルできる", () => {
    const logged: string[] = [];
    const record = (...args: unknown[]) => logged.push(args.join(" "));
    const ajv = new Ajv2020({
      strict: true,
      allErrors: true,
      logger: { log: record, warn: record, error: record },
    });

    expect(() => ajv.compile(ManifestSchema)).not.toThrow();
    expect(logged).toEqual([]);
  });
});
