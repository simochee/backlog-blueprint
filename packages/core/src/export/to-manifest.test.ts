import { describe, expect, it } from "vitest";

import { fixedResourceSnapshots } from "../../../test-utils/src/index";
import { type ResourceSnapshots } from "../plan";
import { type ExistingCustomField } from "../resources/custom-fields";
import { type IssueTypesSnapshot } from "../resources/issue-types";
import { expandEnvironment } from "../validation/expand-stage";
import { type SourceMap } from "../validation/source-map";
import { toManifest } from "./to-manifest";

/** プロジェクトは必ず1件以上の課題種別を持つ（V-A9） */
const issueTypes = (): IssueTypesSnapshot => ({
  source: "project",
  issueTypes: [{ id: 11, name: "タスク", color: "#7ea800" }],
});

const exported = (overrides: Partial<ResourceSnapshots> = {}) =>
  toManifest(fixedResourceSnapshots({ issueTypes: issueTypes(), ...overrides }));

const manifestOf = (overrides: Partial<ResourceSnapshots> = {}) => {
  const { manifest, diagnostics } = exported(overrides);

  expect(diagnostics).toEqual([]);
  if (manifest === undefined) {
    throw new Error("expected a manifest");
  }

  return manifest;
};

const idsOf = (overrides: Partial<ResourceSnapshots>) =>
  exported(overrides).diagnostics.map(({ id }) => id);

const withSettings = (settings: Record<string, unknown>): Partial<ResourceSnapshots> => ({
  project: { exists: true, id: 100, name: "プロジェクトA", settings: settings as never },
});

const customField = (overrides: Partial<ExistingCustomField>): ExistingCustomField => ({
  id: 1,
  name: "見積もり",
  typeId: 3,
  applicableIssueTypes: [],
  ...overrides,
});

const webhook = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: "Slack 通知",
  hookUrl: "https://hooks.example.test/T000/B000",
  allEvent: false,
  activityTypeIds: [1],
  ...overrides,
});

const NO_SOURCE: SourceMap = {
  positionAt: () => ({ line: 0, column: 0 }),
  isEmptySource: () => false,
};

describe("存在しないプロジェクト", () => {
  it("存在しないプロジェクトは EX-3 になり、マニフェストは作られない", () => {
    const { diagnostics, manifest } = exported({
      project: { exists: false },
    });

    expect(manifest).toBeUndefined();
    expect(diagnostics).toEqual([
      {
        id: "EX-3",
        severity: "error",
        stage: "snapshot",
        path: "key",
        message: "project not found: PROJ_A",
        hint: expect.stringContaining("export reads an existing project and does not create one"),
      },
    ]);
  });
});

describe("書き出すキーの並びと過不足", () => {
  it("トップレベルはスキーマ定義の順に並び、$schema は書かない", () => {
    expect(Object.keys(manifestOf())).toEqual([
      "key",
      "name",
      "settings",
      "issueTypes",
      "statuses",
      "categories",
      "milestones",
      "customFields",
      "access",
      "webhooks",
    ]);
  });

  it("配列キーは0件でも空配列を書き、access は3キーとも書く", () => {
    const manifest = manifestOf();

    expect(manifest.categories).toEqual([]);
    expect(manifest.milestones).toEqual([]);
    expect(manifest.customFields).toEqual([]);
    expect(manifest.webhooks).toEqual([]);
    expect(manifest.access).toEqual({ teams: [], members: [], administrators: [] });
  });
});

describe("基本設定の射影", () => {
  it("スキーマにある14キーだけを、スキーマ定義の順で書く", () => {
    const manifest = manifestOf(
      withSettings({
        useWiki: true,
        textFormattingRule: "markdown",
        projectKey: "PROJ_A",
        archived: false,
      }),
    );

    expect(manifest.settings).toEqual({ textFormattingRule: "markdown", useWiki: true });
    expect(Object.keys(manifest.settings ?? {})).toEqual(["textFormattingRule", "useWiki"]);
  });

  it("真偽値のはずの項目が文字列なら止まる", () => {
    expect(idsOf(withSettings({ useWiki: "true" }))).toEqual(["EX-9c"]);
  });

  it("enum の外にある textFormattingRule は止まる", () => {
    expect(idsOf(withSettings({ textFormattingRule: "html" }))).toEqual(["EX-9c"]);
  });
});

describe("課題種別とステータス", () => {
  it("既定ステータスは名前だけで書き、色は付けない", () => {
    expect(manifestOf().statuses).toEqual([
      { name: "未対応" },
      { name: "処理中" },
      { name: "処理済み" },
      { name: "完了" },
    ]);
  });

  it("追加されたステータスは応答の順のまま、色を添えて書く", () => {
    const manifest = manifestOf({
      statuses: {
        source: "project",
        statuses: [
          { id: 1, name: "未対応", color: "#ed8077" },
          { id: 5, name: "レビュー中", color: "#4caf93" },
        ],
      },
    });

    expect(manifest.statuses).toEqual([
      { name: "未対応" },
      { name: "レビュー中", color: "#4caf93" },
    ]);
  });

  it("課題種別は名前と色、テンプレートを応答の順で書く", () => {
    const manifest = manifestOf({
      issueTypes: {
        source: "project",
        issueTypes: [
          { id: 11, name: "タスク", color: "#7ea800" },
          {
            id: 12,
            name: "バグ",
            color: "#e30000",
            templateSummary: "不具合: ",
            templateDescription: "再現手順\n",
          },
        ],
      },
    });

    expect(manifest.issueTypes).toEqual([
      { name: "タスク", color: "#7ea800" },
      {
        name: "バグ",
        color: "#e30000",
        templateSummary: "不具合: ",
        templateDescription: "再現手順\n",
      },
    ]);
  });
});

describe("マイルストーン", () => {
  it("日付は先頭10文字で書く", () => {
    const manifest = manifestOf({
      milestones: [
        {
          id: 21,
          name: "v1.0",
          startDate: "2026-04-01T00:00:00Z",
          releaseDueDate: "2026-06-30T00:00:00Z",
        },
      ],
    });

    expect(manifest.milestones).toEqual([
      { name: "v1.0", startDate: "2026-04-01", releaseDueDate: "2026-06-30" },
    ]);
  });
});

describe("カスタム属性の型ごとの射影", () => {
  it("数値型は数値の範囲と単位を書き、リスト型のキーは書かない", () => {
    const manifest = manifestOf({
      customFields: {
        customFields: [
          customField({
            typeId: 3,
            min: 0,
            max: 100,
            initialValue: 0,
            unit: "人日",
            items: ["混ざってきた選択肢"],
            allowInput: true,
            initialShift: 3,
          }),
        ],
        issueTypes: [],
      },
    });

    expect(manifest.customFields).toEqual([
      { name: "見積もり", type: "number", min: 0, max: 100, initialValue: 0, unit: "人日" },
    ]);
  });

  it("日付型は initialValueType が指す1つの初期値だけを書く", () => {
    const [specified, shifted] = [3, 2].map(
      (initialValueType) =>
        manifestOf({
          customFields: {
            customFields: [
              customField({
                name: "期限",
                typeId: 4,
                min: "2026-01-01T00:00:00Z",
                max: "2026-12-31T00:00:00Z",
                initialDate: "2026-04-01T00:00:00Z",
                initialValueType,
                initialShift: 7,
              }),
            ],
            issueTypes: [],
          },
        }).customFields ?? [],
    );

    expect(specified).toEqual([
      {
        name: "期限",
        type: "date",
        min: "2026-01-01",
        max: "2026-12-31",
        initialDate: "2026-04-01",
        initialValueType: "specifiedDate",
      },
    ]);
    expect(shifted).toEqual([
      {
        name: "期限",
        type: "date",
        min: "2026-01-01",
        max: "2026-12-31",
        initialValueType: "todayPlusShift",
        initialShift: 7,
      },
    ]);
  });

  it("テキスト型は型固有のキーを1つも書かない", () => {
    const manifest = manifestOf({
      customFields: {
        customFields: [
          customField({ name: "備考", typeId: 2, unit: "人日", items: ["a"], allowInput: true }),
        ],
        issueTypes: [],
      },
    });

    expect(manifest.customFields).toEqual([{ name: "備考", type: "textArea" }]);
  });

  it("リスト型は選択肢と入力の許可を書き、false でも落とさない", () => {
    const manifest = manifestOf({
      customFields: {
        customFields: [
          customField({
            name: "環境",
            typeId: 5,
            required: false,
            items: ["本番", "検証"],
            allowInput: false,
            allowAddItem: false,
          }),
        ],
        issueTypes: [],
      },
    });

    expect(manifest.customFields).toEqual([
      {
        name: "環境",
        type: "singleList",
        required: false,
        items: ["本番", "検証"],
        allowInput: false,
        allowAddItem: false,
      },
    ]);
  });

  it("適用する課題種別は名前で書き、絞られていなければキーごと省く", () => {
    const manifest = manifestOf({
      issueTypes: {
        source: "project",
        issueTypes: [
          { id: 11, name: "タスク", color: "#7ea800" },
          { id: 12, name: "バグ", color: "#e30000" },
        ],
      },
      customFields: {
        customFields: [
          customField({ applicableIssueTypes: [12] }),
          customField({ id: 2, name: "影響範囲", typeId: 1 }),
        ],
        issueTypes: [
          { id: 11, name: "タスク" },
          { id: 12, name: "バグ" },
        ],
      },
    });

    expect(manifest.customFields).toEqual([
      { name: "見積もり", type: "number", applicableIssueTypes: ["バグ"] },
      { name: "影響範囲", type: "text" },
    ]);
  });
});

describe("参加者", () => {
  it("プロジェクト管理者は members から除く", () => {
    const manifest = manifestOf({
      access: {
        teams: [{ id: 31, name: "開発チーム" }],
        members: [{ id: 1 }, { id: 2 }],
        administrators: [{ id: 2 }],
        spaceUsers: [],
        spaceTeams: [],
      },
    });

    expect(manifest.access).toEqual({ teams: [31], members: [1], administrators: [2] });
  });

  it("チームにも属している個人参加者は members に残る", () => {
    const manifest = manifestOf({
      access: {
        teams: [{ id: 31, name: "開発チーム" }],
        members: [{ id: 1 }],
        administrators: [],
        spaceUsers: [],
        spaceTeams: [{ id: 31, name: "開発チーム", members: [{ id: 1 }] }],
      },
    });

    expect(manifest.access?.members).toEqual([1]);
  });

  it("チームにはチーム名を、利用者にはプロジェクトの応答の表示名を、コメント用の名前として渡す", () => {
    const { accessLabels } = exported({
      access: {
        teams: [{ id: 31, name: "開発チーム" }],
        members: [{ id: 1, name: "山田 太郎" }],
        administrators: [{ id: 2, name: "鈴木 花子" }],
        spaceUsers: [],
        spaceTeams: [],
      },
    });

    expect(accessLabels?.teams.get(31)).toBe("開発チーム");
    expect(accessLabels?.users.get(1)).toBe("山田 太郎");
    expect(accessLabels?.users.get(2)).toBe("鈴木 花子");
  });

  it("表示名が空の利用者にはコメント用の名前を渡さない", () => {
    const { accessLabels } = exported({
      access: {
        teams: [],
        members: [{ id: 1, name: "" }, { id: 2 }],
        administrators: [],
        spaceUsers: [],
        spaceTeams: [],
      },
    });

    expect(accessLabels?.users.size).toBe(0);
  });
});

describe("Webhook", () => {
  it("hookUrl は取得値をマニフェストに書く", () => {
    const first = webhook();
    const second = webhook({ id: 2, name: "監査ログ", hookUrl: "https://audit.example.test" });
    const { manifest } = exported({ webhooks: [first, second] });

    expect(manifest?.webhooks?.map(({ hookUrl }) => hookUrl)).toEqual([
      "https://hooks.example.test/T000/B000",
      "https://audit.example.test",
    ]);
  });

  it("すべてのイベントを送る Webhook は all と書く", () => {
    const manifest = manifestOf({
      webhooks: [webhook({ allEvent: true, activityTypeIds: [] })],
    });

    expect(manifest.webhooks?.[0]?.events).toBe("all");
  });

  it("イベントは昇順に並び、名前を引けない ID は数値のまま書く", () => {
    const manifest = manifestOf({
      webhooks: [webhook({ activityTypeIds: [12, 999, 1] })],
    });

    expect(manifest.webhooks?.[0]?.events).toEqual(["issueCreated", "gitPushed", 999]);
  });
});

describe("${ を含む値", () => {
  const values = ["${NAME}", "a ${B} c", "$${X}", "${foo", "${}"];

  const descriptions = () =>
    manifestOf({
      milestones: values.map((description, index) => ({
        id: 21 + index,
        name: `v1.${index}`,
        description,
      })),
    }).milestones?.map((milestone) => milestone.description);

  it("展開の対象になる参照だけをエスケープし、閉じていない ${ はそのまま書く", () => {
    expect(descriptions()).toEqual(["$${NAME}", "a $${B} c", "$$${X}", "${foo", "${}"]);
  });

  it("書き出した値を環境変数なしで読み戻すと、Backlog 側の値に戻る", () => {
    const manifest = manifestOf({
      milestones: values.map((description, index) => ({
        id: 21 + index,
        name: `v1.${index}`,
        description,
      })),
    });

    const { parsed } = expandEnvironment(
      { value: manifest, source: NO_SOURCE },
      { env: {}, severity: "error" },
    );
    const { milestones } = parsed.value as { milestones: { description: string }[] };

    expect(milestones.map(({ description }) => description)).toEqual(values);
  });
});

describe("マニフェストとして表現できない実状", () => {
  it("同名のリソースは種別ごとに、2つ目以降の位置で止まる", () => {
    const { diagnostics, manifest } = exported({
      categories: [
        { id: 41, name: "インフラ" },
        { id: 42, name: "インフラ" },
      ],
    });

    expect(manifest).toBeUndefined();
    expect(diagnostics).toEqual([
      {
        id: "EX-9a",
        severity: "error",
        stage: "snapshot",
        path: "categories/1/name",
        message: 'another category is already named "インフラ"',
        hint: expect.stringContaining("rename one of them in Backlog"),
      },
    ]);
  });

  it("表現できない実状は1件で止まらず、全件並ぶ", () => {
    const { diagnostics, manifest } = exported({
      project: {
        exists: true,
        id: 100,
        name: "プロジェクトA",
        settings: { textFormattingRule: "html" } as never,
      },
      issueTypes: {
        source: "project",
        issueTypes: [
          { id: 11, name: "タスク}", color: "#7ea800" },
          { id: 12, name: "バグ", color: "#123456" },
        ],
      },
      customFields: {
        customFields: [
          customField({ id: 1, name: "環境", typeId: 5, items: [] }),
          customField({ id: 2, name: "担当", typeId: 1, applicableIssueTypes: [99] }),
          customField({ id: 3, name: "未知", typeId: 99 }),
          customField({ id: 4, name: "期限", typeId: 4, initialValueType: 99 }),
        ],
        issueTypes: [],
      },
      webhooks: [webhook({ activityTypeIds: [] })],
    });

    expect(manifest).toBeUndefined();
    expect(diagnostics.map(({ id, path }) => [id, path])).toEqual([
      ["EX-9c", "settings/textFormattingRule"],
      ["EX-9b", "issueTypes/0/name"],
      ["EX-9c", "issueTypes/1/color"],
      ["EX-9g", "customFields/0/items"],
      ["EX-9e", "customFields/1/applicableIssueTypes/0"],
      ["EX-9d", "customFields/2/type"],
      ["EX-9d", "customFields/3/initialValueType"],
      ["EX-9f", "webhooks/0/events"],
    ]);
  });
});

describe("書き出したマニフェストが検証を通ること", () => {
  it("日付型の範囲に日付でない値が入っていれば止まる", () => {
    const { diagnostics, manifest } = exported({
      customFields: {
        customFields: [customField({ name: "期限", typeId: 4, min: 3, max: "2026-12-31" })],
        issueTypes: [],
      },
    });

    expect(manifest).toBeUndefined();
    expect(diagnostics).toEqual([
      {
        id: "EX-9h",
        severity: "error",
        stage: "snapshot",
        path: "customFields/0/min",
        message: expect.stringContaining("this value cannot go into a manifest:"),
        hint: expect.stringContaining("the manifest validator rejects it (V-A11)"),
      },
    ]);
  });

  it("開始日が終了日より後のマイルストーンは止まる", () => {
    const { diagnostics, manifest } = exported({
      milestones: [{ id: 21, name: "v1.0", startDate: "2026-07-01", releaseDueDate: "2026-06-30" }],
    });

    expect(manifest).toBeUndefined();
    expect(diagnostics.map(({ id, path }) => [id, path])).toEqual([
      ["EX-9h", "milestones/0/startDate"],
    ]);
  });

  it("EX-9 が指した位置に、同じ誤りを言う指摘を重ねない", () => {
    expect(
      idsOf({
        issueTypes: {
          source: "project",
          issueTypes: [{ id: 11, name: "タスク", color: "#123456" }],
        },
      }),
    ).toEqual(["EX-9c"]);
  });
});
