import { describe, expect, it } from "vitest";

import { validateInBrowser } from "./validation";

const MANIFEST = [
  "key: PROJ_A",
  "name: プロジェクトA",
  "issueTypes:",
  "  - name: タスク",
  '    color: "#7ea800"',
  "webhooks:",
  "  - name: Slack 通知",
  '    hookUrl: "${SLACK_WEBHOOK_URL}"',
  "    events: [issueCreated]",
  "",
].join("\n");

const entered = (values: Record<string, string>) => (name: string) => values[name] ?? "";

describe("貼り付けられたマニフェストをブラウザの中で検証する", () => {
  it("値がすべて入っていれば計画に進めるマニフェストになる", () => {
    const result = validateInBrowser({
      text: MANIFEST,
      valueOf: entered({ SLACK_WEBHOOK_URL: "https://hooks.example/abc" }),
    });

    expect(result.diagnostics).toStrictEqual([]);
    expect(result.manifest?.key).toBe("PROJ_A");
  });

  it("値が未入力のあいだは計画に進めない", () => {
    const result = validateInBrowser({ text: MANIFEST, valueOf: entered({}) });

    expect(result.manifest).toBe(undefined);
  });

  it("未入力は「環境変数が未定義」ではなく「値が未入力」として出る", () => {
    const { diagnostics } = validateInBrowser({ text: MANIFEST, valueOf: entered({}) });

    expect(diagnostics.map(({ message }) => message)).toStrictEqual([
      "value is not entered: SLACK_WEBHOOK_URL",
    ]);
  });

  it("値を入れた path は通常の文字列として扱われる", () => {
    const result = validateInBrowser({
      text: MANIFEST,
      valueOf: entered({ SLACK_WEBHOOK_URL: "https://hooks.example/abc" }),
    });

    expect(result.manifest?.webhooks[0]?.hookUrl).toBe("https://hooks.example/abc");
  });

  it("入力欄を作るべき名前を返す", () => {
    const result = validateInBrowser({ text: MANIFEST, valueOf: entered({}) });

    expect(result.names).toStrictEqual(["SLACK_WEBHOOK_URL"]);
  });

  it("Yaml が壊れていれば構文の誤りを位置付きで出す", () => {
    const { diagnostics, manifest } = validateInBrowser({
      text: "key: PROJ_A\n  name: broken\n",
      valueOf: entered({}),
    });

    expect(manifest).toBe(undefined);
    expect(diagnostics[0]?.id).toBe("V-A23");
    expect(typeof diagnostics[0]?.line).toBe("number");
  });

  it("未入力の値はキーの書式違反として二重に報告されない", () => {
    const { diagnostics } = validateInBrowser({
      text: [
        'key: "${PROJECT_KEY}"',
        "name: プロジェクトA",
        "issueTypes:",
        "  - name: タスク",
        '    color: "#7ea800"',
        "",
      ].join("\n"),
      valueOf: entered({}),
    });

    expect(diagnostics.map(({ id }) => id)).toStrictEqual(["V-A4"]);
  });
});
