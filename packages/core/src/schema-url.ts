/**
 * `export/` の下にも `packages/schema` にも置かない。`$id` と `export` の先頭行は同じ URL で
 * なければならず（EX-15）、schema は core に依存しているので core にしか置けない。
 * パッケージ名を `apps/cli/package.json` から読まないのは、core が CLI に依存できないため。
 */
const CLI_PACKAGE_NAME = "@simochee/backlog-blueprint";

export const PROJECT_SCHEMA_PATH = "schema.json";

export const projectSchemaUrl = (version: string): string =>
  `https://cdn.jsdelivr.net/npm/${CLI_PACKAGE_NAME}@${version}/${PROJECT_SCHEMA_PATH}`;
