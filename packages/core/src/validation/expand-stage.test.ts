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

  it("展開後の値は素の文字列で、展開した path は別に返る", () => {
    const { parsed, expandedPaths } = expand(MANIFEST, ENV);

    expect(typeof (parsed.value as { name: unknown }).name).toBe("string");
    expect([...expandedPaths]).toEqual(["name", "webhooks/0/hookUrl"]);
  });

  it("リテラルに戻しただけの値は展開した path に入らない", () => {
    const { expandedPaths } = expand(MANIFEST, ENV);

    expect(expandedPaths.has("webhooks/0/templateDescription")).toBe(false);
  });

  it("Yaml に直接書かれた値は展開した path に入らない", () => {
    const { expandedPaths } = expand(MANIFEST, ENV);

    expect(expandedPaths.has("webhooks/0/name")).toBe(false);
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
