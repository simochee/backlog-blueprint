import { describe, expect, it } from "vitest";

import { expandEnvironment, hasEnvSentinel, type Environment } from "./expand-stage";
import { type ParsedDocument } from "./source-map";
import { parseManifestSyntax } from "./syntax-stage";

const parse = (text: string): ParsedDocument => {
  const { parsed } = parseManifestSyntax(text);

  if (!parsed) {
    throw new Error("parse failed");
  }

  return parsed;
};

const expand = (text: string, env: Environment = {}, severity: "error" | "warning" = "error") =>
  expandEnvironment(parse(text), { env, severity });

const MANIFEST = `name: \${PROJECT_NAME}
webhooks:
  - name: 通知
    hookUrl: \${SLACK_URL}
    templateDescription: $\${SLACK_URL}
`;

const ENV = { PROJECT_NAME: "プロジェクトA", SLACK_URL: "https://hooks.example/abc" };

describe("環境変数の展開", () => {
  it("すべての文字列値が展開の対象になる", () => {
    const { parsed } = expand(MANIFEST, ENV);

    expect(parsed.value).toMatchObject({
      name: "プロジェクトA",
      webhooks: [{ hookUrl: "https://hooks.example/abc" }],
    });
  });

  it("キー名は展開されない", () => {
    const { parsed } = expand("${NOT_A_KEY}: value\n", { NOT_A_KEY: "expanded" });

    expect(parsed.value).toEqual({ "${NOT_A_KEY}": "value" });
  });

  it("$$ を前置した参照はリテラルの ${NAME} になる", () => {
    const { parsed } = expand(MANIFEST, ENV);

    expect(parsed.value).toMatchObject({
      webhooks: [{ templateDescription: "${SLACK_URL}" }],
    });
  });

  it("展開後の値は通常の文字列になる", () => {
    const { parsed } = expand(MANIFEST, ENV);

    expect((parsed.value as { name: string }).name).toBe("プロジェクトA");
  });
});

describe("解決できない環境変数", () => {
  it("未定義の変数は位置付きで報告される", () => {
    const { diagnostics } = expand(MANIFEST, { SLACK_URL: "https://hooks.example/abc" });

    expect(diagnostics).toEqual([
      expect.objectContaining({
        id: "V-A4",
        severity: "error",
        stage: "expand",
        path: "name",
        line: 1,
        column: 1,
        message: "environment variable is not defined: PROJECT_NAME",
      }),
    ]);
  });

  it("未定義の変数は1件目で止めずすべて列挙される", () => {
    const { diagnostics } = expand(MANIFEST);

    expect(diagnostics.map(({ path }) => path)).toEqual(["name", "webhooks/0/hookUrl"]);
  });

  it("警告に下げても報告される内容は変わらない", () => {
    const { diagnostics } = expand(MANIFEST, {}, "warning");

    expect(diagnostics.map(({ severity }) => severity)).toEqual(["warning", "warning"]);
  });

  it("未解決の値は後続のステージが判定に使わない番兵に置き換わる", () => {
    const { parsed } = expand(MANIFEST, {});
    const { name } = parsed.value as { name: string };

    expect(hasEnvSentinel(name)).toBe(true);
    expect(name).not.toBe("");
    expect(name).not.toBe("PROJECT_NAME");
    expect(name).not.toBe("${PROJECT_NAME}");
  });

  it("解決できた値は番兵ではない", () => {
    const { parsed } = expand(MANIFEST, ENV);

    expect(hasEnvSentinel((parsed.value as { name: string }).name)).toBe(false);
  });
});

describe("真偽値・数値を受け付ける欄への展開（E-10）", () => {
  const valueOf = (text: string, env: Environment) => expand(text, env).parsed.value;

  it("値全体が1つの参照なら、真偽値の欄では真偽値になる", () => {
    expect(valueOf("settings:\n  chartEnabled: ${CHART}\n", { CHART: "true" })).toEqual({
      settings: { chartEnabled: true },
    });
  });

  it("値全体が1つの参照なら、整数の欄では数値になる", () => {
    expect(valueOf("access:\n  teams:\n    - ${QA_TEAM}\n", { QA_TEAM: "31" })).toEqual({
      access: { teams: [31] },
    });
  });

  it("文字列の欄では、数値に見える値も文字列のまま残る", () => {
    expect(valueOf("name: ${NAME}\n", { NAME: "123" })).toEqual({ name: "123" });
  });

  it("ほかの文字と並べた参照は変換されない", () => {
    expect(
      valueOf("settings:\n  chartEnabled: ${CHART}${SUFFIX}\n", { CHART: "tr", SUFFIX: "ue" }),
    ).toEqual({
      settings: { chartEnabled: "true" },
    });
  });

  it("$$ でエスケープしたリテラルは変換されない", () => {
    expect(valueOf("settings:\n  chartEnabled: $${CHART}\n", { CHART: "true" })).toEqual({
      settings: { chartEnabled: "${CHART}" },
    });
  });

  it("JSON の表記でない値は変換されず、文字列のまま型の検証に渡る", () => {
    expect(valueOf("settings:\n  chartEnabled: ${CHART}\n", { CHART: "yes" })).toEqual({
      settings: { chartEnabled: "yes" },
    });
    expect(valueOf("access:\n  teams:\n    - ${QA_TEAM}\n", { QA_TEAM: "0x1F" })).toEqual({
      access: { teams: ["0x1F"] },
    });
  });

  it("数値として表せない大きさの値は、文字列のまま型の検証に渡る", () => {
    expect(
      valueOf("customFields:\n  - name: 見積\n    type: number\n    initialValue: ${INITIAL}\n", {
        INITIAL: "1e400",
      }),
    ).toMatchObject({ customFields: [{ initialValue: "1e400" }] });
  });

  it("カスタム属性の範囲は、数値なら数値に、日付なら文字列のままになる", () => {
    const text =
      "customFields:\n  - name: 見積\n    type: number\n    min: ${MIN}\n    max: ${MAX}\n";

    expect(valueOf(text, { MIN: "-1.5", MAX: "2026-12-31" })).toMatchObject({
      customFields: [{ min: -1.5, max: "2026-12-31" }],
    });
  });

  it("Webhook のイベントは、数値なら ID に、名前なら文字列のままになる", () => {
    const text =
      "webhooks:\n  - name: 通知\n    hookUrl: https://hooks.example\n    events:\n      - ${ID}\n      - ${EVENT}\n";

    expect(valueOf(text, { ID: "12", EVENT: "issueCreated" })).toMatchObject({
      webhooks: [{ events: [12, "issueCreated"] }],
    });
  });

  it("判別条件（if）が挙げる値は、その欄が受け付ける型として扱われない", () => {
    const text = "customFields:\n  - name: 見積\n    type: ${TYPE}\n";

    expect(valueOf(text, { TYPE: "1" })).toMatchObject({ customFields: [{ type: "1" }] });
  });
});
