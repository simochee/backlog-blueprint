/**
 * `export/` の下にも `packages/schema` にも置かない。`$id` と `export` の先頭行は同じ URL で
 * なければならず（EX-15）、schema は core に依存しているので core にしか置けない。
 */
export const SCHEMA_DISTRIBUTION_ORIGIN = "https://simochee.github.io/backlog-blueprint";

export const projectSchemaPath = (version: string): string => `schema/${version}/project.json`;

export const projectSchemaUrl = (version: string): string =>
  `${SCHEMA_DISTRIBUTION_ORIGIN}/${projectSchemaPath(version)}`;
