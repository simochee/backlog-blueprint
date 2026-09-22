import { describe, expect, it } from "vitest";

import { renderExportNotes } from "./export";

const notes = (input: Partial<Parameters<typeof renderExportNotes>[0]> = {}) =>
  renderExportNotes({ projectKey: "PROJ_A", issueCount: 0, ...input });

describe("export の案内", () => {
  it("課題が無ければ何も案内しない", () => {
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

  it("色を付けても行の構造は変わらない", () => {
    const input = { projectKey: "PROJ_A", issueCount: 43 };
    const painted = renderExportNotes(input, { paint: (_style, text) => `<${text}>` });

    expect(painted.split("\n").length).toBe(renderExportNotes(input).split("\n").length);
    expect(painted).toContain("<NOTE  PROJ_A holds 43 issues");
  });
});
