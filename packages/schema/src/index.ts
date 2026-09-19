import { ManifestSchema } from "@backlog-blueprint/core";

const DIALECT = "https://json-schema.org/draft/2020-12/schema";

const DISTRIBUTION_ORIGIN = "https://simochee.github.io/backlog-blueprint";

export const projectSchemaPath = (version: string): string => `schema/${version}/project.json`;

export const projectSchemaUrl = (version: string): string =>
  `${DISTRIBUTION_ORIGIN}/${projectSchemaPath(version)}`;

export const projectSchema = (version: string) => ({
  $schema: DIALECT,
  $id: projectSchemaUrl(version),
  ...ManifestSchema,
});

export type SchemaArtifact = { path: string; contents: string };

/**
 * ファイルを書かずに置き場所と中身を返す。`packages/schema` が `node:fs` を持つと
 * ブラウザ向けのバンドルに Node 専用 API が混ざる経路ができる（NFR-5）。
 */
export const projectSchemaArtifact = (version: string): SchemaArtifact => ({
  path: projectSchemaPath(version),
  contents: `${JSON.stringify(projectSchema(version), null, 2)}\n`,
});
