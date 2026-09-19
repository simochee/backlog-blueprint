import { actionLine, type Action, type Diagnostic } from "@backlog-blueprint/core";
import { describe, expect, it } from "vitest";

import { badgedAction, diagnosticView, PLAIN } from "./view";

const created: Action = {
  id: "statuses/create/レビュー中",
  phase: 3,
  kind: "status",
  op: "create",
  name: "レビュー中",
  writeRequest: true,
};

const updated: Action = {
  id: "issueTypes/update/バグ",
  phase: 2,
  kind: "issueType",
  op: "update",
  name: "バグ",
  writeRequest: true,
  changes: [
    { field: "templateSummary", before: null, after: "【不具合】" },
    { field: "color", before: "#990000", after: "#990000" },
  ],
};

const diagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  id: "V-A15",
  severity: "warning",
  stage: "plan",
  path: "categories",
  message: "resulting order differs from manifest",
  ...overrides,
});

describe("計画の行をバッジに置き換える", () => {
  it("記号はバッジに移り、行には残らない", () => {
    const { symbol, text } = badgedAction(created);

    expect(symbol).toBe("+");
    expect(text.startsWith("status")).toBe(true);
  });

  it("バッジと行を戻すと core が描いた行になる", () => {
    const { symbol, text } = badgedAction(created);

    expect(`${symbol} ${text}`).toBe(actionLine(created, "plan", PLAIN));
  });

  it("操作の種類はバッジの見た目に渡す", () => {
    expect(badgedAction(created).style).toBe("create");
  });

  it("値の変わらない項目は変更行に出さない", () => {
    expect(badgedAction(updated).changes).toStrictEqual([
      'templateSummary: (none) -> "【不具合】"',
    ]);
  });
});

describe("診断に行番号を添えて並べる", () => {
  it("診断1件ごとに core の文面が1つ対応する", () => {
    const diagnostics = [diagnostic(), diagnostic({ id: "V-A16", path: "access/members/0" })];
    const { blocks } = diagnosticView(diagnostics);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.text).toContain("[V-A15]");
    expect(blocks[1]?.text).toContain("[V-A16]");
  });

  it("件数の要約は診断の文面に混ざらない", () => {
    const { summary, blocks } = diagnosticView([diagnostic({ severity: "error" })]);

    expect(summary).toBe("1 validation error.");
    expect(blocks[0]?.text.startsWith("ERROR")).toBe(true);
  });

  it("警告だけのときは件数の要約が出ない", () => {
    expect(diagnosticView([diagnostic()]).summary).toBe(undefined);
  });

  it("診断が無ければ何も並べない", () => {
    expect(diagnosticView([])).toStrictEqual({ blocks: [] });
  });
});
