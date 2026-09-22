import { describe, expect, it } from "vitest";

import { renderExportNotes } from "./export";

const notes = (input: Partial<Parameters<typeof renderExportNotes>[0]> = {}) =>
  renderExportNotes({ projectKey: "PROJ_A", issueCount: 0, webhookVariables: [], ...input });

const WEBHOOK_VARIABLES = [
  { variable: "WEBHOOK_URL_1", webhook: "Slack 通知" },
  { variable: "WEBHOOK_URL_2", webhook: "監査ログ" },
];

describe("export の案内", () => {
  it("課題も Webhook も無ければ何も案内しない", () => {
    expect(notes()).toBe("");
  });

  it("課題を持つプロジェクトには、雛形として使うには key と name を変えることを案内する", () => {
    expect(notes({ issueCount: 43 })).toBe(
      `NOTE  PROJ_A holds 43 issues, so plan and apply will refuse it as a target (V-B3)
  → to use this manifest as a template, change key and name before you apply it`,
    );
  });

  it("課題が1件のときは単数形で数える", () => {
    expect(notes({ issueCount: 1 })).toContain("PROJ_A holds 1 issue,");
  });

  it("置き換えた Webhook URL を変数名と Webhook 名の対応で案内する", () => {
    expect(notes({ webhookVariables: WEBHOOK_VARIABLES })).toBe(
      `NOTE  2 webhook URLs were left out of the manifest and replaced with \${WEBHOOK_URL_n}:
  WEBHOOK_URL_1  "Slack 通知"
  WEBHOOK_URL_2  "監査ログ"
  → set each variable to the URL shown on that webhook's page in Backlog before running plan. validate does not need them`,
    );
  });

  it("Webhook が1つのときは単数形で、変数名そのものを案内に書く", () => {
    expect(notes({ webhookVariables: WEBHOOK_VARIABLES.slice(0, 1) })).toContain(
      "NOTE  1 webhook URL was left out of the manifest and replaced with ${WEBHOOK_URL_1}:",
    );
  });

  it("課題件数の案内、空行、Webhook の案内の順に並ぶ", () => {
    expect(
      notes({ issueCount: 43, webhookVariables: WEBHOOK_VARIABLES })
        .split("\n\n")
        .map((section) => section.split("\n")[0]),
    ).toEqual([
      "NOTE  PROJ_A holds 43 issues, so plan and apply will refuse it as a target (V-B3)",
      "NOTE  2 webhook URLs were left out of the manifest and replaced with ${WEBHOOK_URL_n}:",
    ]);
  });

  it("色を付けても行の構造は変わらない", () => {
    const input = { projectKey: "PROJ_A", issueCount: 43, webhookVariables: WEBHOOK_VARIABLES };
    const painted = renderExportNotes(input, { paint: (_style, text) => `<${text}>` });

    expect(painted.split("\n").length).toBe(renderExportNotes(input).split("\n").length);
    expect(painted).toContain("<NOTE  PROJ_A holds 43 issues");
  });
});
