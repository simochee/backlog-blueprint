import { describe, expect, it } from "vitest";

import { type ManifestInput } from "../manifest";
import { parseManifestSyntax } from "../validation/syntax-stage";
import { serializeManifest } from "./serialize";

const VERSION = "1.2.3";

const manifestOf = (rest: Partial<ManifestInput> = {}): ManifestInput => ({
  key: "PROJ_A",
  name: "プロジェクトA",
  ...rest,
});

const serialize = (manifest: ManifestInput) => serializeManifest(manifest, { version: VERSION });

const readBack = (manifest: ManifestInput): unknown => {
  const { diagnostics, parsed } = parseManifestSyntax(serialize(manifest));

  if (!parsed) {
    throw new Error(diagnostics.map(({ message }) => message).join(", "));
  }

  return parsed.value;
};

describe("書き出したマニフェストの体裁", () => {
  it("先頭行はスキーマを指すコメントで、その次の行からキーが始まる", () => {
    const [comment, first] = serialize(manifestOf()).split("\n");

    expect(comment).toBe(
      "# yaml-language-server: $schema=https://simochee.github.io/backlog-blueprint/schema/1.2.3/project.json",
    );
    expect(first).toBe("key: PROJ_A");
  });

  it("スキーマの URL には実行中のツールの版が入る", () => {
    expect(serializeManifest(manifestOf(), { version: "0.1.0" })).toContain("/schema/0.1.0/");
  });

  it("$schema はコメントだけで、キーとしては書かれない", () => {
    const yaml = serialize({ ...manifestOf(), $schema: "https://example.test/other.json" });

    expect(yaml).not.toContain("$schema:");
    expect(yaml).not.toContain("example.test");
  });

  it("コメントは先頭行だけで、それ以外の行には現れない", () => {
    const yaml = serialize(
      manifestOf({
        categories: [{ name: "フロントエンド" }],
        webhooks: [{ name: "Slack", hookUrl: "${WEBHOOK_URL_1}", events: "all" }],
      }),
    );

    expect(yaml.split("\n").slice(1).join("\n")).not.toContain("#");
  });

  it("インデントは2スペースで、配列の - は親キーより1段下げる", () => {
    const yaml = serialize(
      manifestOf({ customFields: [{ name: "影響範囲", type: "singleList", items: ["軽微"] }] }),
    );

    expect(yaml).toContain("customFields:\n  - name: 影響範囲\n");
    expect(yaml).toContain("    items:\n      - 軽微\n");
  });

  it("長い値でも行を折り返さない", () => {
    const description = "あ".repeat(200);
    const yaml = serialize(manifestOf({ milestones: [{ name: "v1.0.0", description }] }));

    expect(yaml).toContain(`description: ${description}\n`);
  });

  it("同じ内容の要素が並んでもアンカーとエイリアスを出さない", () => {
    const category = { name: "フロントエンド" };
    const yaml = serialize(manifestOf({ categories: [category, category] }));

    expect(yaml).not.toContain("&");
    expect(yaml).not.toContain("*");
  });

  it("末尾は改行1つで終わる", () => {
    const yaml = serialize(manifestOf({ categories: [{ name: "フロントエンド" }] }));

    expect(yaml.endsWith("\n")).toBe(true);
    expect(yaml.endsWith("\n\n")).toBe(false);
  });
});

describe("キーの並び", () => {
  it("トップレベルはスキーマ定義の順に並ぶ", () => {
    const yaml = serialize({
      webhooks: [],
      access: { teams: [], members: [], administrators: [] },
      customFields: [],
      milestones: [],
      categories: [],
      statuses: [],
      issueTypes: [],
      settings: { useGit: true },
      name: "プロジェクトA",
      key: "PROJ_A",
    });

    expect(yaml.split("\n").filter((line) => /^\S/u.test(line) && !line.startsWith("#"))).toEqual([
      "key: PROJ_A",
      "name: プロジェクトA",
      "settings:",
      "issueTypes: []",
      "statuses: []",
      "categories: []",
      "milestones: []",
      "customFields: []",
      "access:",
      "webhooks: []",
    ]);
  });

  it("配列の要素は name を先頭に置き、以下は各スキーマの表の順に並ぶ", () => {
    const yaml = serialize(
      manifestOf({
        issueTypes: [
          {
            templateDescription: "## 再現手順\n",
            templateSummary: "【不具合】",
            color: "#990000",
            name: "バグ",
          },
        ],
        milestones: [
          {
            releaseDueDate: "2026-12-31",
            startDate: "2026-10-01",
            name: "v1.0.0",
            description: "初回",
          },
        ],
      }),
    );

    expect(yaml).toContain(
      'issueTypes:\n  - name: バグ\n    color: "#990000"\n    templateSummary: 【不具合】\n    templateDescription: |\n',
    );
    expect(yaml).toContain(
      "milestones:\n  - name: v1.0.0\n    description: 初回\n    startDate: 2026-10-01\n    releaseDueDate: 2026-12-31\n",
    );
  });

  it("settings は指定した順ではなくスキーマ定義の順に並ぶ", () => {
    const yaml = serialize(
      manifestOf({
        settings: { useGit: true, chartEnabled: false, textFormattingRule: "markdown" },
      }),
    );

    expect(yaml).toContain(
      "settings:\n  textFormattingRule: markdown\n  chartEnabled: false\n  useGit: true\n",
    );
  });

  it("カスタム属性の型固有キーは共通キーの後ろに置かれる", () => {
    const yaml = serialize(
      manifestOf({
        customFields: [
          {
            items: ["軽微"],
            name: "影響範囲",
            required: true,
            allowInput: false,
            type: "singleList",
          },
        ],
      }),
    );

    expect(yaml).toContain(
      "customFields:\n  - name: 影響範囲\n    type: singleList\n    required: true\n    items:\n      - 軽微\n    allowInput: false\n",
    );
  });

  it("access は teams・members・administrators の順に並ぶ", () => {
    const yaml = serialize(
      manifestOf({ access: { administrators: ["yamada"], members: ["suzuki"], teams: ["QA"] } }),
    );

    expect(yaml).toContain(
      "access:\n  teams:\n    - QA\n  members:\n    - suzuki\n  administrators:\n    - yamada\n",
    );
  });
});

describe("空の配列と空の settings", () => {
  it("0件の配列は [] として書かれる", () => {
    expect(serialize(manifestOf({ categories: [], webhooks: [] }))).toContain(
      "categories: []\nwebhooks: []\n",
    );
  });

  it("settings が空なら settings キーごと書かれない", () => {
    expect(serialize(manifestOf({ settings: {} }))).not.toContain("settings");
  });

  it("settings が渡されなければ settings キーは書かれない", () => {
    expect(serialize(manifestOf())).not.toContain("settings");
  });
});

describe("書き出した Yaml をこのツールのパーサが読み戻す", () => {
  it("* で始まるユーザー ID はエイリアス参照ではなく文字列として読み戻る", () => {
    const manifest = manifestOf({ access: { members: ["*oNejJk6xEn"], administrators: ["*abc"] } });

    expect(readBack(manifest)).toEqual(manifest);
  });

  it("# で始まる色はコメントではなく文字列として読み戻る", () => {
    const manifest = manifestOf({
      issueTypes: [{ name: "タスク", color: "#7ea800" }],
      statuses: [{ name: "レビュー中", color: "#3b9dbd" }],
    });

    expect(readBack(manifest)).toEqual(manifest);
  });

  it("Yaml が非文字列に読みうる名前も文字列として読み戻る", () => {
    const manifest = manifestOf({
      categories: ["123", "true", "false", "null", "~", "1e3", "yes", "no", "on", "off"].map(
        (name) => ({ name }),
      ),
    });

    expect(readBack(manifest)).toEqual(manifest);
  });

  it("前後に空白のある名前と空文字列は、そのままの長さで読み戻る", () => {
    const manifest = manifestOf({
      categories: [{ name: " 先頭に空白" }, { name: "末尾に空白 " }],
      milestones: [{ name: "v1.0.0", description: "" }],
    });

    expect(readBack(manifest)).toEqual(manifest);
  });

  it("${...} を含む値は展開も解釈もされずそのまま読み戻る", () => {
    const manifest = manifestOf({
      webhooks: [
        { name: "Slack", hookUrl: "${WEBHOOK_URL_1}", events: ["issueCreated"] },
        { name: "監査", hookUrl: "$${NAME}", events: "all" },
      ],
    });

    expect(readBack(manifest)).toEqual(manifest);
  });

  it("日本語と絵文字はエスケープされずそのまま読み戻る", () => {
    const manifest = manifestOf({ name: "プロジェクトA 🎉", categories: [{ name: "設計 ✅" }] });

    expect(serialize(manifest)).toContain("🎉");
    expect(readBack(manifest)).toEqual(manifest);
  });

  it("複数行の課題テンプレートはリテラルブロックで書かれ、末尾改行の有無が保たれる", () => {
    const withNewline = "## 再現手順\n## 期待する挙動\n";
    const withoutNewline = "## 再現手順\n## 期待する挙動";
    const manifest = manifestOf({
      issueTypes: [
        { name: "バグ", color: "#990000", templateDescription: withNewline },
        { name: "要望", color: "#2779ca", templateDescription: withoutNewline },
      ],
    });
    const yaml = serialize(manifest);

    expect(yaml).toContain("templateDescription: |\n");
    expect(yaml).toContain("templateDescription: |-\n");
    expect(readBack(manifest)).toEqual(manifest);
  });

  it("数値・真偽値・日付は型を変えずに読み戻る", () => {
    const manifest = manifestOf({
      settings: { chartEnabled: true, useGit: false },
      milestones: [{ name: "v1.0.0", startDate: "2026-10-01", releaseDueDate: "2026-12-31" }],
      customFields: [
        { name: "見積工数", type: "number", min: 0, max: 100, required: false, unit: "人日" },
        { name: "期限", type: "date", initialValueType: "todayPlusShift", initialShift: -3 },
      ],
    });

    expect(readBack(manifest)).toEqual(manifest);
  });

  it("例示のマニフェスト全体が、書き出して読み戻しても一致する", () => {
    const manifest: ManifestInput = {
      key: "PROJ_A",
      name: "プロジェクトA",
      settings: { textFormattingRule: "markdown", subtaskingEnabled: true, useWiki: true },
      issueTypes: [
        { name: "タスク", color: "#7ea800" },
        {
          name: "バグ",
          color: "#990000",
          templateSummary: "【不具合】",
          templateDescription: "## 再現手順\n## 期待する挙動\n",
        },
      ],
      statuses: [{ name: "未対応" }, { name: "レビュー中", color: "#3b9dbd" }, { name: "完了" }],
      categories: [{ name: "フロントエンド" }],
      milestones: [{ name: "v1.0.0", description: "初回リリース", startDate: "2026-10-01" }],
      customFields: [
        {
          name: "影響範囲",
          type: "singleList",
          required: true,
          applicableIssueTypes: ["バグ"],
          items: ["軽微", "重大"],
        },
      ],
      access: { teams: ["開発チーム"], members: ["*oNejJk6xEn"], administrators: ["yamada"] },
      webhooks: [
        {
          name: "Slack 通知",
          hookUrl: "${WEBHOOK_URL_1}",
          events: ["issueCreated", "issueUpdated"],
        },
      ],
    };

    expect(readBack(manifest)).toEqual(manifest);
  });
});

describe("同じ入力からは同じ出力が出る", () => {
  it("キーを書いた順が違っても出力は一致する", () => {
    const first = serialize({
      key: "PROJ_A",
      name: "P",
      categories: [],
      settings: { useGit: true },
    });
    const second = serialize({
      settings: { useGit: true },
      categories: [],
      name: "P",
      key: "PROJ_A",
    });

    expect(first).toBe(second);
  });
});
