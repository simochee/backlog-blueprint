import { createRequire } from "node:module";

/**
 * `import ... with { type: "json" }` を使わない。tsconfig の `include` は `src` だけで、
 * package.json を読み込むとプログラムの外のファイルを型検査に引き込むことになる。
 */
const manifest = createRequire(import.meta.url)("../package.json") as {
  name: string;
  version: string;
};

export const TOOL = { name: manifest.name, version: manifest.version };
