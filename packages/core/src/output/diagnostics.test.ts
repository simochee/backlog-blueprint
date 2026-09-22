import { describe, expect, it } from "vitest";

import { type Diagnostic } from "../diagnostic";
import { renderDiagnostics, renderWarnings } from "./diagnostics";

const missingStatus: Diagnostic = {
  id: "V-A6",
  severity: "error",
  stage: "semantic",
  path: "statuses",
  line: 12,
  message: "default statuses cannot be deleted\nmissing default status: 処理済み",
  hint: 'add "処理済み" to statuses, or rename it with oldname',
};

const hasIssues: Diagnostic = {
  id: "V-B3",
  severity: "error",
  stage: "snapshot",
  path: "key",
  message: "project already has issues\nPROJ_A: 43 issues",
  hint: "only projects with zero issues can be targeted",
};

describe("検証結果の出力", () => {
  it("検証 ID とマニフェスト上の位置、詳細、直し方を並べる", () => {
    expect(renderDiagnostics([missingStatus, hasIssues])).toBe(
      `2 validation errors.

ERROR [V-A6] statuses: default statuses cannot be deleted
  missing default status: 処理済み
  → add "処理済み" to statuses, or rename it with oldname

ERROR [V-B3] key: project already has issues
  PROJ_A: 43 issues
  → only projects with zero issues can be targeted`,
    );
  });

  it("ステージ順、同じステージでは行順に並ぶ", () => {
    const later: Diagnostic = { ...missingStatus, id: "V-A8", line: 30 };
    const earlier: Diagnostic = { ...missingStatus, id: "V-A7", line: 3 };

    expect(
      renderDiagnostics([hasIssues, later, earlier])
        .split("\n")
        .filter((line) => line.startsWith("ERROR")),
    ).toEqual([
      "ERROR [V-A7] statuses: default statuses cannot be deleted",
      "ERROR [V-A8] statuses: default statuses cannot be deleted",
      "ERROR [V-B3] key: project already has issues",
    ]);
  });

  it("配列の添字は表示から落とし、マニフェストのキーだけを継ぐ", () => {
    const diagnostic: Diagnostic = {
      id: "V-A16",
      severity: "warning",
      stage: "plan",
      path: "access/members/0",
      message: '"suzuki" already belongs to team "開発チーム"',
    };

    expect(renderWarnings([diagnostic])).toBe(
      `Warnings:
  ! [V-A16] access.members: "suzuki" already belongs to team "開発チーム"`,
    );
  });

  it("直しようが無い警告には、なぜそうなるかを添える", () => {
    const diagnostic: Diagnostic = {
      id: "V-A15",
      severity: "warning",
      stage: "plan",
      path: "categories",
      message:
        "resulting order differs from manifest\nmanifest: フロントエンド, バックエンド, インフラ\nresult:   インフラ, フロントエンド, バックエンド",
      hint: "New items are always appended after existing ones; there is no reorder API.",
    };

    expect(renderWarnings([diagnostic])).toBe(
      `Warnings:
  ! [V-A15] categories: resulting order differs from manifest
      manifest: フロントエンド, バックエンド, インフラ
      result:   インフラ, フロントエンド, バックエンド
      New items are always appended after existing ones; there is no reorder API.`,
    );
  });

  it("警告の節に検証エラーは混ぜない", () => {
    expect(renderWarnings([missingStatus])).toBe("");
  });
});

const firstLine = (text: string) => text.split("\n")[0];

describe("検証エラーの集計行", () => {
  it("エラーが1件なら単数で数える", () => {
    expect(firstLine(renderDiagnostics([missingStatus]))).toBe("1 validation error.");
  });

  it("適用が絡むときだけ、何も適用されていないことを添える", () => {
    expect(firstLine(renderDiagnostics([missingStatus], { nothingApplied: true }))).toBe(
      "1 validation error. Nothing has been applied.",
    );
  });

  it("書き出しが絡むときは、エラーを export のものとして数え、何も書かれていないことを添える", () => {
    expect(firstLine(renderDiagnostics([missingStatus, hasIssues], { nothingWritten: true }))).toBe(
      "2 export errors. Nothing has been written.",
    );
  });

  it("警告しか無いときは集計行を出さない", () => {
    const warning: Diagnostic = { ...missingStatus, severity: "warning" };

    expect(firstLine(renderDiagnostics([warning]))).toBe(
      "WARNING [V-A6] statuses: default statuses cannot be deleted",
    );
  });

  it("警告は検証エラーとして数えない", () => {
    const warning: Diagnostic = { ...hasIssues, severity: "warning" };

    expect(firstLine(renderDiagnostics([missingStatus, warning]))).toBe("1 validation error.");
  });
});
