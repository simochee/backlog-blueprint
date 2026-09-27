import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { projectSchemaArtifact } from "@backlog-blueprint/schema";
import { type Plugin, defineConfig } from "vite";

import cliPackage from "./package.json";

/**
 * スキーマの書き出しを `packages/schema` に置かない。ファイルを書くには Node が要り、
 * プラットフォーム依存が入る（NFR-5）。
 *
 * `emitFile` で出さない。置き場所はパッケージの直下で、Rollup は出力先の外に書かせない。
 */
const schemaArtifact = (): Plugin => {
  let root = "";

  return {
    name: "backlog-blueprint:schema",
    configResolved(config) {
      ({ root } = config);
    },
    async writeBundle() {
      const { path, contents } = projectSchemaArtifact(cliPackage.version);

      await writeFile(resolve(root, path), contents);
    },
  };
};

/**
 * 依存を external にしない。ワークスペースのパッケージは `.ts` のソースを `exports` にしており
 * （B-1）、拡張子の無い相対 import も含めて Node には読めない。`--configLoader runner` が
 * 要るのも同じ理由で、既定のローダはそれらを external にして Node に読ませる。
 *
 * `banner` で shebang を足さない。`src/main.ts` が持っており、2行になる。
 */
export default defineConfig({
  build: {
    target: "node22",
    ssr: "src/main.ts",
    outDir: "dist",
    rollupOptions: {
      output: { entryFileNames: "main.js" },
    },
  },
  plugins: [schemaArtifact()],
  ssr: { noExternal: true },
});
