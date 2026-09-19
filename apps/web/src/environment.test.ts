import { parseManifestSyntax, type ParsedDocument } from "@backlog-blueprint/core";
import { describe, expect, it } from "vitest";

import { environmentReferences, missingValueDiagnostics, referencedNames } from "./environment";

const parse = (text: string): ParsedDocument => {
  const { parsed } = parseManifestSyntax(text);

  if (parsed === undefined) {
    throw new TypeError("the fixture must be valid YAML");
  }

  return parsed;
};

const names = (text: string): string[] => referencedNames(environmentReferences(parse(text)));

describe("値の入力欄はマニフェストの ${NAME} から作る", () => {
  it("文字列の中に書かれた名前を拾う", () => {
    expect(names('key: PROJ_A\nwebhooks:\n  - hookUrl: "${SLACK_WEBHOOK_URL}"\n')).toStrictEqual([
      "SLACK_WEBHOOK_URL",
    ]);
  });

  it("同じ名前が何度書かれても入力欄は1つ", () => {
    expect(names('a: "${TOKEN}"\nb: "${TOKEN}"\n')).toStrictEqual(["TOKEN"]);
  });

  it("1つの文字列に2つ書かれていれば両方を拾う", () => {
    expect(names('a: "${HOST}/${PATH}"\n')).toStrictEqual(["HOST", "PATH"]);
  });

  it("入れ子の配列の中の名前も拾う", () => {
    expect(names('a:\n  - - "${DEEP}"\n')).toStrictEqual(["DEEP"]);
  });

  it("$${NAME} はそのまま出す指定なので入力欄を作らない", () => {
    expect(names('a: "$${LITERAL}"\n')).toStrictEqual([]);
  });

  it("キーに書かれた名前では入力欄を作らない", () => {
    expect(names('"${KEY}": value\n')).toStrictEqual([]);
  });
});

describe("値が未入力のときの指摘", () => {
  const document = parse('key: PROJ_A\nwebhooks:\n  - hookUrl: "${SLACK_WEBHOOK_URL}"\n');
  const references = environmentReferences(document);

  it("環境変数ではなく入力欄の値について述べる", () => {
    const [diagnostic] = missingValueDiagnostics(references, document.source, () => false);

    expect(diagnostic?.message).toBe("value is not entered: SLACK_WEBHOOK_URL");
    expect(diagnostic?.id).toBe("V-A4");
    expect(diagnostic?.severity).toBe("error");
  });

  it("書かれている行を示す", () => {
    const [diagnostic] = missingValueDiagnostics(references, document.source, () => false);

    expect(diagnostic?.line).toBe(3);
  });

  it("値が入っている名前は指摘しない", () => {
    expect(missingValueDiagnostics(references, document.source, () => true)).toStrictEqual([]);
  });
});
