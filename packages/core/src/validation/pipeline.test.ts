import { describe, expect, it } from "vitest";

import { type Diagnostic } from "../diagnostic";
import { validateManifest, type SchemaStage } from "./pipeline";

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

describe("展開した値の経路", () => {
  it("展開できた path が結果に載る", () => {
    const result = validateManifest({
      text: `${MANIFEST}webhooks:\n  - name: 通知\n    hookUrl: \${SLACK_URL}\n    events: all\n`,
      schemaStage: acceptingSchemaStage,
      env: { SLACK_URL: "https://hooks.example/abc" },
    });

    expect([...result.expandedPaths]).toEqual(["webhooks/0/hookUrl"]);
    expect(result.manifest?.webhooks[0]?.hookUrl).toBe("https://hooks.example/abc");
  });
});
