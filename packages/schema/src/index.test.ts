import { ManifestSchema, projectSchemaPath, projectSchemaUrl } from "@backlog-blueprint/core";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { projectSchema, projectSchemaArtifact } from "./index";

type Node = Record<string, unknown>;

const isReferenceBranch = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  "pattern" in value &&
  String((value as Node).pattern).includes(String.raw`\$\{`);

const withoutReferenceBranches = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(withoutReferenceBranches);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const node = value as Node;

  if (Array.isArray(node.anyOf) && node.anyOf.length === 2 && isReferenceBranch(node.anyOf[1])) {
    return withoutReferenceBranches(node.anyOf[0]);
  }

  return Object.fromEntries(
    Object.entries(node).map(([key, child]) => [key, withoutReferenceBranches(child)]),
  );
};

const at = (schema: unknown, ...keys: string[]): Node =>
  keys.reduce<Node>((node, key) => node[key] as Node, schema as Node);

const validatePublished = new Ajv2020({ allErrors: true, strict: false }).compile(
  projectSchema("1.2.3"),
);

const accepts = (manifest: unknown): boolean => validatePublished(manifest);

const MINIMAL = {
  key: "PROJ_A",
  name: "プロジェクトA",
  issueTypes: [{ name: "タスク", color: "#7ea800" }],
};

describe("配布する JSON Schema", () => {
  it("本体は手書きされず、参照の受け口を外せばコード側のスキーマ定義そのものである", () => {
    const { $schema: _dialect, $id: _url, ...body } = projectSchema("1.2.3");

    expect(JSON.stringify(withoutReferenceBranches(body))).toBe(JSON.stringify(ManifestSchema));
  });

  it("plan まで待たないと判定できない制約を、書いている最中に読める形で運ぶ", () => {
    const access = at(projectSchema("1.2.3"), "properties", "access", "properties") as {
      administrators: { description: string };
      members: { description: string };
      teams: { description: string };
    };

    expect(access.administrators.description).toContain("space administrator");
    expect(access.members.description).toContain("Login IDs");
    expect(access.teams.description).toContain("team");
  });

  it("draft 2020-12 を宣言する", () => {
    expect(projectSchema("1.2.3").$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });

  it("$id は配布先の URL であり、パスにバージョンを含む", () => {
    expect(projectSchema("1.2.3").$id).toBe(
      "https://simochee.github.io/backlog-blueprint/schema/1.2.3/project.json",
    );
  });

  it("バージョンは呼び出し側が渡した semver がそのまま入る", () => {
    expect(projectSchemaUrl("0.1.0")).toBe(
      "https://simochee.github.io/backlog-blueprint/schema/0.1.0/project.json",
    );
  });
});

describe("エディタでの ${NAME}（E-9）", () => {
  it("展開前には判定できない欄に ${NAME} を書いても違反にならない", () => {
    expect(
      accepts({
        ...MINIMAL,
        key: "${PROJECT_KEY}",
        settings: { chartEnabled: "${CHART}" },
        issueTypes: [{ name: "タスク", color: "${TASK_COLOR}" }],
        milestones: [{ name: "v1", startDate: "${START}" }],
        customFields: [{ name: "見積", type: "number", min: "${MIN}", initialValue: "${INITIAL}" }],
        access: { teams: ["${QA_TEAM}"] },
        webhooks: [{ name: "通知", hookUrl: "${URL}", events: ["${EVENT_ID}", "issueCreated"] }],
      }),
    ).toBe(true);
  });

  it("ほかの文字と並べた ${NAME} も受け付ける", () => {
    expect(accepts({ ...MINIMAL, key: "PROJ_${ENV}" })).toBe(true);
  });

  it("イベントの一覧全体を ${NAME} で書いても、oneOf の複数の枝に一致しない", () => {
    expect(
      accepts({
        ...MINIMAL,
        webhooks: [{ name: "通知", hookUrl: "https://hooks.example", events: "${EVENTS}" }],
      }),
    ).toBe(true);
  });

  it("$$ でエスケープしたリテラルは参照として扱わず、制約どおりに判定する", () => {
    expect(accepts({ ...MINIMAL, key: "$${PROJECT_KEY}" })).toBe(false);
  });

  it("参照を含まない値は、これまでどおり制約で判定する", () => {
    expect(accepts({ ...MINIMAL, key: "proj_a" })).toBe(false);
    expect(accepts({ ...MINIMAL, issueTypes: [{ name: "タスク", color: "#000000" }] })).toBe(false);
    expect(accepts({ ...MINIMAL, settings: { chartEnabled: "true" } })).toBe(false);
  });

  it("参照を受け付ける欄でも、ホバーに出す説明は失われない", () => {
    expect(at(projectSchema("1.2.3"), "properties", "key").description).toBe(
      at(ManifestSchema, "properties", "key").description,
    );
  });

  it("型ごとの必須パラメータは緩めない", () => {
    expect(accepts({ ...MINIMAL, customFields: [{ name: "区分", type: "list" }] })).toBe(false);
  });

  it("実行時のスキーマは緩めない", () => {
    expect(at(ManifestSchema, "properties", "key").pattern).toBeDefined();
    expect(at(ManifestSchema, "properties", "key").anyOf).toBeUndefined();
  });
});

describe("生成物の置き場所", () => {
  it("配布構成の schema/<version>/project.json に置かれる", () => {
    expect(projectSchemaPath("0.1.0")).toBe("schema/0.1.0/project.json");
    expect(projectSchemaArtifact("0.1.0").path).toBe("schema/0.1.0/project.json");
  });

  it("中身は整形された JSON テキストで、末尾に改行がある", () => {
    const { contents } = projectSchemaArtifact("0.1.0");
    const parsed = JSON.parse(contents) as { $id: string };

    expect(contents.endsWith("\n")).toBe(true);
    expect(contents).toContain("\n  ");
    expect(parsed.$id).toBe(projectSchemaUrl("0.1.0"));
  });

  it("$id の URL と生成物の置き場所が一致する", () => {
    expect(projectSchemaUrl("0.1.0").endsWith(projectSchemaPath("0.1.0"))).toBe(true);
  });
});
