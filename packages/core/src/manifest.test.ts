import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { ISSUE_TYPE_COLORS, ManifestSchema, normalizeManifest } from "./manifest";
import { WEBHOOK_EVENTS } from "./webhook-events";

const validate = new Ajv2020({ allErrors: true }).compile(ManifestSchema);

const accepts = (manifest: unknown): boolean => validate(manifest);

const rejectedPaths = (manifest: unknown): string[] =>
  validate(manifest) ? [] : (validate.errors ?? []).map((error) => error.instancePath);

const minimal = { key: "PROJ_A", name: "プロジェクトA" };

const withCustomField = (field: Record<string, unknown>) => ({
  ...minimal,
  customFields: [{ name: "影響範囲", ...field }],
});

const withWebhookEvents = (events: unknown) => ({
  ...minimal,
  webhooks: [{ name: "Slack 通知", hookUrl: "https://hooks.example.test/T000", events }],
});

describe("トップレベル", () => {
  it("key と name だけを書いたマニフェストが受理される", () => {
    expect(accepts(minimal)).toBe(true);
  });

  it("必須なのは key と name だけで、課題種別とステータスは書かなくても受理される", () => {
    expect(accepts({ key: "PROJ_A" })).toBe(false);
    expect(accepts({ name: "プロジェクトA" })).toBe(false);
    expect(accepts(minimal)).toBe(true);
  });

  it("未知のキーを持つマニフェストは受理されない", () => {
    expect(accepts({ ...minimal, unknownKey: "value" })).toBe(false);
  });

  it("未知のキーは入れ子の中でも受理されない", () => {
    expect(accepts({ ...minimal, settings: { useWiki: true, useSomething: true } })).toBe(false);
    expect(accepts({ ...minimal, categories: [{ name: "設計", order: 1 }] })).toBe(false);
  });

  it("$schema を書いても受理され、他のキーの解釈は変わらない", () => {
    const manifest = {
      $schema: "https://simochee.github.io/backlog-blueprint/schema/0.1.0/project.json",
      ...minimal,
    };

    expect(accepts(manifest)).toBe(true);
    expect(normalizeManifest(manifest).name).toBe("プロジェクトA");
  });

  it("プロジェクトキーは英大文字・数字・アンダースコア以外を含められない", () => {
    expect(accepts({ ...minimal, key: "proj-a" })).toBe(false);
    expect(accepts({ ...minimal, key: "PROJ_A2" })).toBe(true);
  });

  it("プロジェクト名を空文字にはできない", () => {
    expect(accepts({ ...minimal, name: "" })).toBe(false);
  });
});

describe("省略された値の読まれ方", () => {
  it("配列キーを省いたマニフェストは空配列として読まれる", () => {
    const manifest = normalizeManifest(minimal);

    expect(manifest.issueTypes).toEqual([]);
    expect(manifest.statuses).toEqual([]);
    expect(manifest.categories).toEqual([]);
    expect(manifest.milestones).toEqual([]);
    expect(manifest.customFields).toEqual([]);
    expect(manifest.webhooks).toEqual([]);
  });

  it("access を省いたマニフェストは3キーとも空配列として読まれる", () => {
    expect(normalizeManifest(minimal).access).toEqual({
      teams: [],
      members: [],
      administrators: [],
    });
  });

  it("access の一部だけを書いたとき、書かなかったキーは空配列として読まれる", () => {
    const manifest = normalizeManifest({ ...minimal, access: { administrators: [1] } });

    expect(manifest.access).toEqual({
      teams: [],
      members: [],
      administrators: [1],
    });
  });

  it("settings の省略されたキーは false ではなく存在しないものとして読まれる", () => {
    const manifest = normalizeManifest({ ...minimal, settings: { useWiki: true } });

    expect(manifest.settings).toEqual({ useWiki: true });
    expect("useGit" in manifest.settings).toBe(false);
  });

  it("settings に書かれた false は省略と区別される", () => {
    const manifest = normalizeManifest({ ...minimal, settings: { useGit: false } });

    expect("useGit" in manifest.settings).toBe(true);
    expect(manifest.settings.useGit).toBe(false);
  });
});

describe("課題種別", () => {
  const issueType = { name: "調査", color: "#2779ca" };

  it("名前と色を書いた課題種別が受理される", () => {
    expect(accepts({ ...minimal, issueTypes: [issueType] })).toBe(true);
  });

  it("色を書かない課題種別は受理されない", () => {
    expect(accepts({ ...minimal, issueTypes: [{ name: "調査" }] })).toBe(false);
  });

  it("パレット外の色を書いた課題種別は受理されない", () => {
    expect(accepts({ ...minimal, issueTypes: [{ ...issueType, color: "#ea2c00" }] })).toBe(false);
    expect(accepts({ ...minimal, issueTypes: [{ ...issueType, color: "#123456" }] })).toBe(false);
  });

  it("10色のパレットはすべて受理される", () => {
    for (const color of ISSUE_TYPE_COLORS) {
      expect(accepts({ ...minimal, issueTypes: [{ ...issueType, color }] })).toBe(true);
    }
  });

  it("引用符を書き忘れて色が null になったマニフェストは受理されない", () => {
    expect(accepts({ ...minimal, issueTypes: [{ ...issueType, color: null }] })).toBe(false);
  });

  it("空の課題種別の配列は受理されない", () => {
    expect(accepts({ ...minimal, issueTypes: [] })).toBe(false);
  });
});

describe("ステータス", () => {
  it("色を書かないステータスが受理される", () => {
    expect(accepts({ ...minimal, statuses: [{ name: "未対応" }] })).toBe(true);
  });

  it("ステータスの色は課題種別のパレットではなくステータスのパレットで判定される", () => {
    expect(accepts({ ...minimal, statuses: [{ name: "レビュー中", color: "#ea2c00" }] })).toBe(
      true,
    );
    expect(accepts({ ...minimal, statuses: [{ name: "レビュー中", color: "#2779ca" }] })).toBe(
      false,
    );
  });

  it("ステータスは13件以上書けない", () => {
    const statuses = Array.from({ length: 13 }, (_, index) => ({ name: `状態${index}` }));

    expect(accepts({ ...minimal, statuses: statuses.slice(0, 12) })).toBe(true);
    expect(accepts({ ...minimal, statuses })).toBe(false);
  });
});

describe("カテゴリー", () => {
  it("空の名前を持つカテゴリーは受理されない", () => {
    expect(accepts({ ...minimal, categories: [{ name: "設計" }] })).toBe(true);
    expect(accepts({ ...minimal, categories: [{ name: "" }] })).toBe(false);
  });

  it("空の oldname を持つカテゴリーは受理されない", () => {
    expect(accepts({ ...minimal, categories: [{ name: "設計", oldname: "" }] })).toBe(false);
  });
});

describe("マイルストーン", () => {
  it("空の名前を持つマイルストーンは受理されない", () => {
    expect(accepts({ ...minimal, milestones: [{ name: "" }] })).toBe(false);
  });

  it("空の oldname を持つマイルストーンは受理されない", () => {
    expect(accepts({ ...minimal, milestones: [{ name: "v1.0", oldname: "" }] })).toBe(false);
  });

  it("日付は yyyy-MM-dd の文字列でなければ受理されない", () => {
    expect(accepts({ ...minimal, milestones: [{ name: "v1.0", startDate: "2026-10-01" }] })).toBe(
      true,
    );
    expect(accepts({ ...minimal, milestones: [{ name: "v1.0", startDate: "2026/10/01" }] })).toBe(
      false,
    );
  });

  it("引用符を書き忘れて日付が Date として読まれる余地を残さない", () => {
    expect(accepts({ ...minimal, milestones: [{ name: "v1.0", releaseDueDate: 20261001 }] })).toBe(
      false,
    );
  });
});

describe("access", () => {
  it("同じ名前を2度書いたリストは受理されない", () => {
    expect(accepts({ ...minimal, access: { teams: ["開発チーム", "開発チーム"] } })).toBe(false);
    expect(accepts({ ...minimal, access: { members: ["suzuki", "suzuki"] } })).toBe(false);
    expect(accepts({ ...minimal, access: { administrators: ["yamada", "yamada"] } })).toBe(false);
  });
});

describe("カスタム属性", () => {
  it("型は名前で書き、数値の typeId は受理されない", () => {
    expect(accepts(withCustomField({ type: "text" }))).toBe(true);
    expect(accepts(withCustomField({ type: 1 }))).toBe(false);
  });

  it("8種以外の型は受理されない", () => {
    expect(accepts(withCustomField({ type: "list" }))).toBe(false);
  });

  it("リスト型は items が必須である", () => {
    expect(accepts(withCustomField({ type: "singleList" }))).toBe(false);
    expect(accepts(withCustomField({ type: "singleList", items: ["大", "小"] }))).toBe(true);
  });

  it("リスト型の items を空配列にはできない", () => {
    expect(accepts(withCustomField({ type: "singleList", items: [] }))).toBe(false);
  });

  it("空の名前を持つカスタム属性は受理されない", () => {
    expect(accepts({ ...minimal, customFields: [{ name: "", type: "text" }] })).toBe(false);
  });

  it("空の oldname を持つカスタム属性は受理されない", () => {
    expect(accepts(withCustomField({ type: "text", oldname: "" }))).toBe(false);
  });

  it("数値型のカスタム属性の範囲は数値で書く", () => {
    expect(accepts(withCustomField({ type: "number", min: 1, max: 9 }))).toBe(true);
    expect(rejectedPaths(withCustomField({ type: "number", min: "2026-01-01" }))).toContain(
      "/customFields/0/min",
    );
    expect(rejectedPaths(withCustomField({ type: "number", max: "2026-12-31" }))).toContain(
      "/customFields/0/max",
    );
  });

  it("日付型のカスタム属性の範囲は日付文字列で書く", () => {
    expect(accepts(withCustomField({ type: "date", min: "2026-01-01", max: "2026-12-31" }))).toBe(
      true,
    );
    expect(rejectedPaths(withCustomField({ type: "date", min: 1 }))).toContain(
      "/customFields/0/min",
    );
    expect(rejectedPaths(withCustomField({ type: "date", max: 9 }))).toContain(
      "/customFields/0/max",
    );
  });

  it("日付型のカスタム属性の範囲は yyyy-MM-dd 以外の文字列では書けない", () => {
    expect(rejectedPaths(withCustomField({ type: "date", min: "2026/01/01" }))).toContain(
      "/customFields/0/min",
    );
  });

  it("リスト型には min / max を書けない", () => {
    expect(rejectedPaths(withCustomField({ type: "radio", items: ["大"], min: 1 }))).toContain(
      "/customFields/0/min",
    );
    expect(rejectedPaths(withCustomField({ type: "radio", items: ["大"], max: 9 }))).toContain(
      "/customFields/0/max",
    );
  });

  it("数値型にはリスト型のキーを書けない", () => {
    expect(accepts(withCustomField({ type: "number", min: 1, max: 9, unit: "件" }))).toBe(true);
    expect(rejectedPaths(withCustomField({ type: "number", items: ["大"] }))).toContain(
      "/customFields/0/items",
    );
    expect(rejectedPaths(withCustomField({ type: "number", allowInput: true }))).toContain(
      "/customFields/0/allowInput",
    );
  });

  it("日付型には単位も初期値も書けない", () => {
    expect(rejectedPaths(withCustomField({ type: "date", unit: "日" }))).toContain(
      "/customFields/0/unit",
    );
    expect(rejectedPaths(withCustomField({ type: "date", initialValue: 1 }))).toContain(
      "/customFields/0/initialValue",
    );
  });

  it("文字列型と文章型には型固有のキーを1つも書けない", () => {
    for (const type of ["text", "textArea"]) {
      expect(rejectedPaths(withCustomField({ type, min: 1 }))).toContain("/customFields/0/min");
      expect(rejectedPaths(withCustomField({ type, items: ["大"] }))).toContain(
        "/customFields/0/items",
      );
      expect(rejectedPaths(withCustomField({ type, initialValueType: "today" }))).toContain(
        "/customFields/0/initialValueType",
      );
    }
  });

  it("初期値が指定日なら initialDate が必須になり、initialShift は書けない", () => {
    const field = { type: "date", initialValueType: "specifiedDate" };

    expect(accepts(withCustomField(field))).toBe(false);
    expect(accepts(withCustomField({ ...field, initialDate: "2026-10-01" }))).toBe(true);
    expect(rejectedPaths(withCustomField({ ...field, initialShift: 3 }))).toContain(
      "/customFields/0/initialShift",
    );
  });

  it("初期値が当日+シフトなら initialShift が必須になり、initialDate は書けない", () => {
    const field = { type: "date", initialValueType: "todayPlusShift" };

    expect(accepts(withCustomField(field))).toBe(false);
    expect(accepts(withCustomField({ ...field, initialShift: 3 }))).toBe(true);
    expect(rejectedPaths(withCustomField({ ...field, initialDate: "2026-10-01" }))).toContain(
      "/customFields/0/initialDate",
    );
  });

  it("初期値が当日なら日付もシフトも書けない", () => {
    const field = { type: "date", initialValueType: "today" };

    expect(accepts(withCustomField(field))).toBe(true);
    expect(rejectedPaths(withCustomField({ ...field, initialDate: "2026-10-01" }))).toContain(
      "/customFields/0/initialDate",
    );
    expect(rejectedPaths(withCustomField({ ...field, initialShift: 3 }))).toContain(
      "/customFields/0/initialShift",
    );
  });

  it("適用する課題種別を同じ名前で2度書くと受理されない", () => {
    expect(accepts(withCustomField({ type: "text", applicableIssueTypes: ["バグ", "バグ"] }))).toBe(
      false,
    );
  });
});

describe("Webhook", () => {
  it("events: all が受理される", () => {
    expect(accepts(withWebhookEvents("all"))).toBe(true);
  });

  it("all 以外の文字列は受理されない", () => {
    expect(accepts(withWebhookEvents("every"))).toBe(false);
  });

  it("一覧に載っているイベント名はすべて受理される", () => {
    expect(accepts(withWebhookEvents(WEBHOOK_EVENTS.map(({ name }) => name)))).toBe(true);
  });

  it("未知のイベント名は受理されない", () => {
    expect(accepts(withWebhookEvents(["issueCreated", "issueCreatedTypo"]))).toBe(false);
  });

  it("一覧に無い数値は前方互換のために受理される", () => {
    expect(accepts(withWebhookEvents([50]))).toBe(true);
    expect(accepts(withWebhookEvents(["issueCreated", 50]))).toBe(true);
  });

  it("イベントの空配列と重複は受理されない", () => {
    expect(accepts(withWebhookEvents([]))).toBe(false);
    expect(accepts(withWebhookEvents(["issueCreated", "issueCreated"]))).toBe(false);
  });

  it("空の名前を持つ Webhook は受理されない", () => {
    expect(
      accepts({ ...minimal, webhooks: [{ name: "", hookUrl: "https://x.test", events: "all" }] }),
    ).toBe(false);
  });

  it("空の hookUrl を持つ Webhook は受理されない", () => {
    expect(
      accepts({ ...minimal, webhooks: [{ name: "Slack 通知", hookUrl: "", events: "all" }] }),
    ).toBe(false);
  });

  it("events を省いた Webhook は受理されない", () => {
    expect(
      accepts({ ...minimal, webhooks: [{ name: "Slack 通知", hookUrl: "https://example.test" }] }),
    ).toBe(false);
  });
});
