import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { manifestLinter, manifestSchemaExtensions } from "./manifest-schema";

const HEADER = "key: PROJ_A\nname: プロジェクトA\n";

const messages = (text: string): string[] => {
  const view = new EditorView({
    state: EditorState.create({ doc: text, extensions: manifestSchemaExtensions() }),
  });

  try {
    return manifestLinter()(view).map(({ message }) => message);
  } finally {
    view.destroy();
  }
};

describe("マニフェスト入力欄の検証（E-9）", () => {
  it("展開前には判定できない欄の ${NAME} は違反にならない", () => {
    expect(
      messages(
        "key: ${PROJECT_KEY}\nname: プロジェクトA\nsettings:\n  chartEnabled: ${CHART}\nissueTypes:\n  - name: タスク\n    color: ${TASK_COLOR}\n",
      ),
    ).toStrictEqual([]);
  });

  it("パレット外の色は、参照の枝を含まずに許される色を挙げて報告される", () => {
    const [message, ...rest] = messages(
      `${HEADER}issueTypes:\n  - name: タスク\n    color: "#000000"\n`,
    );

    expect(rest).toStrictEqual([]);
    expect(message).toContain("#e30000");
    expect(message).not.toContain("does not match any schema");
  });

  it("形式に合わないプロジェクトキーは、キーの形式の違反として報告される", () => {
    const [message] = messages("key: proj_a\nname: プロジェクトA\n");

    expect(message).toContain("[A-Z0-9_]");
    expect(message).not.toContain("does not match any schema");
  });

  it("真偽値の欄に書いた文字列は、型の違反として報告される", () => {
    const [message] = messages(`${HEADER}settings:\n  chartEnabled: "true"\n`);

    expect(message).toContain("boolean");
    expect(message).not.toContain("does not match any schema");
  });

  it("数値型のカスタム属性の範囲に書いた文字列は、数値でないこととして報告される", () => {
    const [message] = messages(
      `${HEADER}customFields:\n  - name: 見積\n    type: number\n    min: abc\n`,
    );

    expect(message).toContain("number");
    expect(message).not.toContain("does not match any schema");
  });

  it("日付型のカスタム属性の範囲は、日付の形式の違反として報告される", () => {
    const [message] = messages(
      `${HEADER}customFields:\n  - name: 期日\n    type: date\n    min: 2026/01/01\n`,
    );

    expect(message).toContain(String.raw`\d{4}`);
    expect(message).not.toContain("does not match any schema");
  });

  it("Webhook のイベントの誤りは、書ける形として all を挙げて報告される", () => {
    const [message] = messages(
      `${HEADER}webhooks:\n  - name: 通知\n    hookUrl: https://hooks.example\n    events: alll\n`,
    );

    expect(message).toContain("`all`");
    expect(message).not.toContain("undefined");
  });

  it("違反の報告は、どのキーの値かを含む", () => {
    const [message] = messages("key: proj_a\nname: プロジェクトA\n");

    expect(message).toContain("key");
  });
});
