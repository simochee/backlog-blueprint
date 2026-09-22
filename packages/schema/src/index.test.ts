import { ManifestSchema, projectSchemaPath, projectSchemaUrl } from "@backlog-blueprint/core";
import { describe, expect, it } from "vitest";

import { projectSchema, projectSchemaArtifact } from "./index";

describe("配布する JSON Schema", () => {
  it("本体は手書きされず、コード側のスキーマ定義そのものである", () => {
    const { $schema: _dialect, $id: _url, ...body } = projectSchema("1.2.3");

    expect(JSON.stringify(body)).toBe(JSON.stringify(ManifestSchema));
  });

  it("plan まで待たないと判定できない制約を、書いている最中に読める形で運ぶ", () => {
    const access = projectSchema("1.2.3").properties.access.properties;

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
