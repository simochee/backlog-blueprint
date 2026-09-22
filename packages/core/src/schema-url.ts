/**
 * `packages/schema` が `$id` に入れる URL と、`export` が先頭行のコメントに書く URL は
 * 同じでなければならない（EX-15 / 要件定義 §7.1）。`packages/schema` が core に依存して
 * いるので逆向きの import はできず、core が唯一の出どころになる。`export` の関心事では
 * ないので `export/` の下には置かない。
 */
export const SCHEMA_DISTRIBUTION_ORIGIN = "https://simochee.github.io/backlog-blueprint";

export const projectSchemaPath = (version: string): string => `schema/${version}/project.json`;

export const projectSchemaUrl = (version: string): string =>
  `${SCHEMA_DISTRIBUTION_ORIGIN}/${projectSchemaPath(version)}`;
