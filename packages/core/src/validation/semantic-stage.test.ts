import { describe, expect, it } from "vitest";

import { normalizeManifest, type ManifestInput } from "../manifest";
import { expandEnvironment } from "./expand-stage";
import { validateStaticSemantics } from "./semantic-stage";
import { parseManifestSyntax } from "./syntax-stage";

const HEAD = `key: PROJ_A
name: プロジェクトA
issueTypes:
  - name: タスク
    color: "#7ea800"
`;

const validate = (text: string, env: Record<string, string> = {}) => {
  const { parsed } = parseManifestSyntax(text);

  if (!parsed) {
    throw new Error("parse failed");
  }

  const expanded = expandEnvironment(parsed, { env, severity: "error" });

  return validateStaticSemantics(
    normalizeManifest(expanded.parsed.value as ManifestInput),
    expanded.parsed.source,
    expanded.expandedPaths,
  );
};

const idsOf = (text: string, env?: Record<string, string>) =>
  validate(text, env).map(({ id }) => id);

describe("リソース内の名前の重複", () => {
  it("同じ名前が2度書かれた課題種別はエラーになる", () => {
    const diagnostics = validate(`${HEAD}  - name: タスク
    color: "#990000"
`);

    expect(diagnostics).toEqual([
      expect.objectContaining({
        id: "V-A5",
        severity: "error",
        stage: "semantic",
        path: "issueTypes/1/name",
        line: 6,
      }),
    ]);
  });

  it("重複は1件目で止めず、2件目以降をすべて列挙する", () => {
    const diagnostics = validate(`${HEAD}  - name: タスク
    color: "#990000"
  - name: タスク
    color: "#2779ca"
categories:
  - name: 共通
  - name: 共通
`);

    expect(diagnostics.map(({ path }) => path)).toEqual([
      "issueTypes/1/name",
      "issueTypes/2/name",
      "categories/1/name",
    ]);
  });

  it("別のリソースに同じ名前があってもエラーにならない", () => {
    expect(idsOf(`${HEAD}categories:\n  - name: タスク\n`)).toEqual([]);
  });
});

describe("課題種別の件数", () => {
  it("issueTypes のキーを省略するとエラーになる", () => {
    expect(idsOf("key: PROJ_A\nname: プロジェクトA\n")).toEqual(["V-A9"]);
  });

  it("課題種別が1件でもあればエラーにならない", () => {
    expect(idsOf(HEAD)).toEqual([]);
  });
});

describe("カスタム属性が指す課題種別", () => {
  it("issueTypes に無い名前を指すとエラーになる", () => {
    const diagnostics = validate(`${HEAD}customFields:
  - name: 影響範囲
    type: singleList
    items:
      - 軽微
    applicableIssueTypes:
      - バグ
`);

    expect(diagnostics).toEqual([
      expect.objectContaining({
        id: "V-A10",
        path: "customFields/0/applicableIssueTypes/0",
        line: 12,
      }),
    ]);
  });

  it("issueTypes にある名前を指せばエラーにならない", () => {
    expect(
      idsOf(`${HEAD}customFields:
  - name: 影響範囲
    type: singleList
    items:
      - 軽微
    applicableIssueTypes:
      - タスク
`),
    ).toEqual([]);
  });
});

describe("孫課題の設定", () => {
  it("現状を見ないと決まらないので、この段では判定しない", () => {
    expect(
      idsOf(`${HEAD}settings:
  grandchildIssueEnabled: true
  subtaskingEnabled: false
`),
    ).toEqual([]);
  });
});

describe("oldname と name の衝突", () => {
  it("同じリソースの他の要素が使い続けている名前を oldname にするとエラーになる", () => {
    const diagnostics = validate(`${HEAD}  - name: 調査
    oldname: タスク
    color: "#2779ca"
`);

    expect(diagnostics).toEqual([
      expect.objectContaining({ id: "V-A17", path: "issueTypes/1/oldname", line: 7 }),
    ]);
  });

  it("どの要素も使っていない名前を oldname にすればエラーにならない", () => {
    expect(
      idsOf(`${HEAD}  - name: 調査
    oldname: その他
    color: "#2779ca"
`),
    ).toEqual([]);
  });
});

describe("マイルストーンの期間", () => {
  it("開始日が完了予定日より後ならエラーになる", () => {
    const diagnostics = validate(`${HEAD}milestones:
  - name: v1.0.0
    startDate: 2026-12-31
    releaseDueDate: 2026-10-01
`);

    expect(diagnostics).toEqual([
      expect.objectContaining({ id: "V-A19", path: "milestones/0/startDate", line: 8 }),
    ]);
  });

  it("開始日と完了予定日が同じ日ならエラーにならない", () => {
    expect(
      idsOf(`${HEAD}milestones:
  - name: v1.0.0
    startDate: 2026-10-01
    releaseDueDate: 2026-10-01
`),
    ).toEqual([]);
  });

  it("片方しか書かれていなければ判定しない", () => {
    expect(idsOf(`${HEAD}milestones:\n  - name: v1.0.0\n    startDate: 2026-12-31\n`)).toEqual([]);
  });
});

describe("カスタム属性の範囲", () => {
  it("数値型の下限が上限より大きいとエラーになる", () => {
    const diagnostics = validate(`${HEAD}customFields:
  - name: 見積工数
    type: number
    min: 10
    max: 5
`);

    expect(diagnostics).toEqual([
      expect.objectContaining({ id: "V-A20", path: "customFields/0/min", line: 9 }),
    ]);
  });

  it("日付型の範囲は日付文字列として比較される", () => {
    expect(
      idsOf(`${HEAD}customFields:
  - name: 対応期限
    type: date
    min: 2026-12-31
    max: 2026-10-01
`),
    ).toEqual(["V-A20"]);
  });

  it("下限と上限が等しければエラーにならない", () => {
    expect(
      idsOf(`${HEAD}customFields:
  - name: 見積工数
    type: number
    min: 5
    max: 5
`),
    ).toEqual([]);
  });
});

describe("名前に使えない文字", () => {
  it("name に } を含むとエラーになる", () => {
    const diagnostics = validate(`${HEAD}categories:\n  - name: 緊急}対応\n`);

    expect(diagnostics).toEqual([
      expect.objectContaining({ id: "V-A22", path: "categories/0/name", line: 7 }),
    ]);
  });

  it("oldname に } を含むとエラーになる", () => {
    expect(idsOf(`${HEAD}categories:\n  - name: 緊急\n    oldname: 旧}対応\n`)).toEqual(["V-A22"]);
  });

  it("プロジェクト名の } は対象にならない", () => {
    expect(idsOf("key: PROJ_A\nname: プロジェクト}A\nissueTypes:\n  - name: タスク\n")).toEqual([]);
  });

  it("ツールの都合による制約であることが hint に書かれている", () => {
    const [diagnostic] = validate(`${HEAD}categories:\n  - name: 緊急}対応\n`);

    expect(diagnostic?.hint).toContain("Backlog itself allows");
  });
});

describe("未解決の環境変数が入った値", () => {
  it("番兵に置き換わった名前は重複や衝突の判定に使われない", () => {
    expect(
      idsOf(`${HEAD}  - name: \${MISSING}
    color: "#990000"
  - name: \${MISSING}
    color: "#2779ca"
`),
    ).toEqual([]);
  });

  it("番兵に置き換わった日付は比較の判定に使われない", () => {
    expect(
      idsOf(`${HEAD}milestones:
  - name: v1.0.0
    startDate: \${MISSING}
    releaseDueDate: 2026-10-01
`),
    ).toEqual([]);
  });
});

describe("Webhook のイベント", () => {
  const webhook = (events: string) =>
    `${HEAD}webhooks:\n  - name: 通知\n    hookUrl: https://example.test\n    events: ${events}\n`;

  it("CLI が知らない数値のイベントは警告にとどまる", () => {
    const [diagnostic] = validate(webhook("[9999]"));

    expect(diagnostic).toMatchObject({
      id: "V-A24",
      severity: "warning",
      path: "webhooks/0/events/0",
    });
    expect(diagnostic?.message).toContain("9999");
  });

  it("知っている数値のイベントは何も言わない", () => {
    expect(idsOf(webhook("[1, 2]"))).toEqual([]);
  });

  it("イベント名は数値ではないので対象にならない", () => {
    expect(idsOf(webhook("[issueCreated]"))).toEqual([]);
  });

  it("events: all も対象にならない", () => {
    expect(idsOf(webhook("all"))).toEqual([]);
  });

  it("Backlog が後から増やしたイベントでも使えることが hint に書かれている", () => {
    const [diagnostic] = validate(webhook("[9999]"));

    expect(diagnostic?.hint).toContain("sent as written");
  });
});

describe("同定名に書かれた環境変数（V-A25）", () => {
  it("課題種別の名前が ${ENV} 由来なら警告する", () => {
    const [diagnostic] = validate(
      `key: PROJ_A
name: プロジェクトA
issueTypes:
  - name: \${ISSUE_TYPE}
    color: "#7ea800"
`,
      { ISSUE_TYPE: "タスク" },
    );

    expect(diagnostic).toMatchObject({
      id: "V-A25",
      severity: "warning",
      stage: "semantic",
      path: "issueTypes/0/name",
      line: 4,
    });
  });

  it("マスクできない理由が hint に書かれている", () => {
    const [diagnostic] = validate(
      `${HEAD}categories:
  - name: \${CATEGORY}
`,
      { CATEGORY: "共通" },
    );

    expect(diagnostic?.hint).toContain("keys of the reference table");
    expect(diagnostic?.hint).toContain("action id");
  });

  it("oldname・access の各要素・applicableIssueTypes も同定名として警告する", () => {
    const diagnostics = validate(
      `${HEAD}categories:
  - name: 共通
    oldname: \${OLD}
customFields:
  - name: 見積
    type: number
    applicableIssueTypes:
      - \${ISSUE_TYPE}
access:
  members:
    - \${MEMBER}
`,
      { OLD: "きょうつう", ISSUE_TYPE: "タスク", MEMBER: "suzuki" },
    );

    expect(diagnostics.map(({ id, path }) => [id, path])).toEqual([
      ["V-A25", "categories/0/oldname"],
      ["V-A25", "access/members/0"],
      ["V-A25", "customFields/0/applicableIssueTypes/0"],
    ]);
  });

  it("警告なので適用は止まらない", () => {
    const diagnostics = validate(
      `${HEAD}categories:
  - name: \${CATEGORY}
`,
      { CATEGORY: "共通" },
    );

    expect(diagnostics.every(({ severity }) => severity === "warning")).toBe(true);
  });

  it("プロジェクトキーが ${ENV} 由来なら警告する", () => {
    const [diagnostic] = validate(
      `key: \${PROJECT_KEY}
name: プロジェクトA
issueTypes:
  - name: タスク
    color: "#7ea800"
`,
      { PROJECT_KEY: "PROJ_B" },
    );

    expect(diagnostic).toMatchObject({
      id: "V-A25",
      severity: "warning",
      stage: "semantic",
      path: "key",
      line: 1,
    });
  });

  it("プロジェクト名は同定キーではないので警告しない", () => {
    expect(
      idsOf(
        `key: PROJ_A
name: \${PROJECT_NAME}
issueTypes:
  - name: タスク
    color: "#7ea800"
`,
        { PROJECT_NAME: "プロジェクトA" },
      ),
    ).toEqual([]);
  });

  it("Yaml に直接書かれた名前は警告しない", () => {
    expect(idsOf(`${HEAD}categories:\n  - name: 共通\n`)).toEqual([]);
  });
});
