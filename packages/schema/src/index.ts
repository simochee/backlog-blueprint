/**
 * 配布 URL を組み立て直さない。`export` が書き出す `$schema` のコメント行と
 * ここが入れる `$id` は同じ URL でなければならず（EX-15）、2箇所で組み立てると
 * 版の入れ方が食い違ったまま両方とも「正しく見える」状態になる。
 */
import { ManifestSchema, projectSchemaPath, projectSchemaUrl } from "@backlog-blueprint/core";

import { acceptEnvReferences } from "./accept-env-references";

const DIALECT = "https://json-schema.org/draft/2020-12/schema";

export const projectSchema = (version: string) => ({
  $schema: DIALECT,
  $id: projectSchemaUrl(version),
  ...acceptEnvReferences(ManifestSchema),
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
