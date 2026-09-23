import { describe, expect, it } from "vitest";

import { type Diagnostic } from "../diagnostic";
import { validateManifest, type SchemaStage } from "./pipeline";
import { schemaStage } from "./schema-stage";

const acceptingSchemaStage: SchemaStage = () => [];

const schemaStageReporting =
  (...diagnostics: Diagnostic[]): SchemaStage =>
  () =>
    diagnostics;

const schemaDiagnostic = (
  path: string,
  line: number,
  severity: Diagnostic["severity"] = "error",
): Diagnostic => ({
  id: "V-A21",
  severity,
  stage: "schema",
  path,
  line,
  column: 1,
  message: "expected string",
});

const MANIFEST = `key: PROJ_A
name: プロジェクトA
issueTypes:
  - name: タスク
    color: "#7ea800"
`;

describe("ステージ間のゲート", () => {
  it("構文が壊れていればスキーマ検証に進まない", () => {
    const result = validateManifest({
      text: "key: PROJ_A\nissueTypes: [1, 2\n",
      schemaStage: () => {
        throw new Error("schema stage must not run");
      },
    });

    expect(result.diagnostics.map(({ stage }) => stage)).toEqual(["syntax"]);
    expect(result.manifest).toBeUndefined();
  });

  it("スキーマにエラーがあれば静的意味の検証に進まない", () => {
    const result = validateManifest({
      text: "key: PROJ_A\nname: プロジェクトA\nissueTypes: []\n",
      schemaStage: schemaStageReporting(schemaDiagnostic("issueTypes", 3)),
    });

    expect(result.diagnostics.map(({ id }) => id)).toEqual(["V-A21"]);
  });

  it("キーの省略で空になった課題種別は静的意味の検証が捕まえる", () => {
    const result = validateManifest({
      text: "key: PROJ_A\nname: プロジェクトA\n",
      schemaStage: acceptingSchemaStage,
    });

    expect(result.diagnostics.map(({ id }) => id)).toEqual(["V-A9"]);
  });
});

describe("未解決の環境変数があるときの進み方", () => {
  const text = `key: PROJ_A
name: \${MISSING_NAME}
issueTypes:
  - name: タスク
    color: "#7ea800"
  - name: タスク
    color: "#990000"
`;

  it("番兵を入れて静的意味の検証まで進む", () => {
    const result = validateManifest({ text, schemaStage: acceptingSchemaStage });

    expect(result.diagnostics.map(({ id }) => id)).toEqual(["V-A4", "V-A5"]);
  });

  it("番兵が置かれた path のスキーマ違反は報告しない", () => {
    const result = validateManifest({
      text,
      schemaStage: schemaStageReporting(schemaDiagnostic("name", 2)),
    });

    expect(result.diagnostics.map(({ id }) => id)).toEqual(["V-A4", "V-A5"]);
  });

  it("番兵を含むマニフェストは後続の工程に渡らない", () => {
    const result = validateManifest({
      text: "key: PROJ_A\nname: ${MISSING_NAME}\nissueTypes:\n  - name: タスク\n",
      schemaStage: acceptingSchemaStage,
      unresolvedEnvSeverity: "warning",
    });

    expect(result.diagnostics.map(({ severity }) => severity)).toEqual(["warning"]);
    expect(result.manifest).toBeUndefined();
  });
});

describe("未解決の環境変数の重さ", () => {
  const text = "key: PROJ_A\nname: ${MISSING_NAME}\nissueTypes:\n  - name: タスク\n";

  it("既定ではエラーになる", () => {
    const result = validateManifest({ text, schemaStage: acceptingSchemaStage });

    expect(result.diagnostics).toEqual([
      expect.objectContaining({ id: "V-A4", severity: "error" }),
    ]);
  });

  it("警告に下げて呼ぶこともできる", () => {
    const result = validateManifest({
      text,
      schemaStage: acceptingSchemaStage,
      unresolvedEnvSeverity: "warning",
    });

    expect(result.diagnostics).toEqual([
      expect.objectContaining({ id: "V-A4", severity: "warning" }),
    ]);
  });
});

describe("診断の並び", () => {
  it("ステージ順に並び、同じステージでは行の順に並ぶ", () => {
    const text = `key: PROJ_A
name: プロジェクトA
issueTypes:
  - name: タスク
    color: "#7ea800"
  - name: タスク
    color: "#990000"
categories:
  - name: 共通
  - name: 共通
webhooks:
  - name: 通知
    hookUrl: \${MISSING_URL}
    events: all
`;

    const result = validateManifest({
      text,
      schemaStage: schemaStageReporting(schemaDiagnostic("categories", 8, "warning")),
      unresolvedEnvSeverity: "warning",
    });

    expect(result.diagnostics.map(({ stage, line }) => [stage, line])).toEqual([
      ["expand", 13],
      ["schema", 8],
      ["semantic", 6],
      ["semantic", 10],
    ]);
  });
});

describe("展開した値", () => {
  it("展開後の値がマニフェストに載る", () => {
    const result = validateManifest({
      text: `${MANIFEST}webhooks:\n  - name: 通知\n    hookUrl: \${SLACK_URL}\n    events: all\n`,
      schemaStage: acceptingSchemaStage,
      env: { SLACK_URL: "https://hooks.example/abc" },
    });

    expect(result.manifest?.webhooks[0]?.hookUrl).toBe("https://hooks.example/abc");
  });
});

describe("スキーマステージの配線", () => {
  it("引用符を忘れた色は、位置つきで V-A18 として報告される", () => {
    const { diagnostics } = validateManifest({
      text: "key: PROJ_A\nname: プロジェクトA\nissueTypes:\n  - name: バグ\n    color: #990000\n",
      schemaStage,
    });

    expect(diagnostics).toEqual([
      expect.objectContaining({ id: "V-A18", path: "issueTypes/0/color", line: 5 }),
    ]);
  });

  it("明示的に書かれた null は V-A18 にならない", () => {
    const { diagnostics } = validateManifest({
      text: "key: PROJ_A\nname: プロジェクトA\nissueTypes:\n  - name: バグ\n    color: null\n",
      schemaStage,
    });

    expect(diagnostics.every(({ id }) => id === "V-A21")).toBe(true);
  });
});

describe("真偽値・数値の欄に書いた環境変数（E-10）", () => {
  const TEXT = `key: PROJ_A
name: プロジェクトA
settings:
  chartEnabled: \${CHART}
issueTypes:
  - name: タスク
    color: "#7ea800"
access:
  teams:
    - \${QA_TEAM}
`;

  it("解決した値が型の表記どおりなら、そのままスキーマ検証を通る", () => {
    const result = validateManifest({
      text: TEXT,
      schemaStage,
      env: { CHART: "false", QA_TEAM: "31" },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.manifest).toMatchObject({
      settings: { chartEnabled: false },
      access: { teams: [31] },
    });
  });

  it("解決した値が型に合わなければ、その行のスキーマ違反として報告される", () => {
    const result = validateManifest({
      text: TEXT,
      schemaStage,
      env: { CHART: "yes", QA_TEAM: "31" },
    });

    expect(result.diagnostics).toEqual([
      expect.objectContaining({ stage: "schema", path: "settings/chartEnabled", line: 4 }),
    ]);
  });

  it("未解決の参照は、真偽値・数値の欄でも V-A4 としてだけ報告される", () => {
    const result = validateManifest({
      text: TEXT,
      schemaStage,
      unresolvedEnvSeverity: "warning",
    });

    expect(result.diagnostics.map(({ id }) => id)).toEqual(["V-A4", "V-A4"]);
  });
});
