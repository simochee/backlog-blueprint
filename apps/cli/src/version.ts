import { createRequire } from "node:module";

/**
 * `import ... with { type: "json" }` を使わない。`include` の外の package.json を型検査に引き込む。
 */
const manifest = createRequire(import.meta.url)("../package.json") as {
  name: string;
  version: string;
};

export const TOOL = { name: manifest.name, version: manifest.version };
