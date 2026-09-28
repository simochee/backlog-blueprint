import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type * as Schema from "@backlog-blueprint/schema";
import { type Plugin, defineConfig, runnerImport } from "vite-plus";

import cliPackage from "./package.json";

/**
 * スキーマの書き出しを `packages/schema` に置かない。ファイルを書くには Node が要り、
 * プラットフォーム依存が入る（NFR-5）。
 *
 * `emitFile` で出さない。置き場所はパッケージの直下で、バンドラは出力先の外に書かせない。
 *
 * `@backlog-blueprint/schema` を設定ファイルの先頭で import しない。ワークスペースの
 * パッケージは `.ts` のソースを `exports` にしており（B-1）、拡張子の無い相対 import も
 * 含めて Node には読めない。設定ファイルは Node がそのまま読むので、Vite に解決させる
 * `runnerImport` で書き出すときに読む。
 */
const schemaArtifact = (): Plugin => ({
  name: "backlog-blueprint:schema",
  async writeBundle() {
    const { module: schema } = await runnerImport<typeof Schema>("@backlog-blueprint/schema");
    const { path, contents } = schema.projectSchemaArtifact(cliPackage.version);

    await writeFile(resolve(import.meta.dirname, path), contents);
  },
});

export default defineConfig({
  pack: {
    entry: ["src/main.ts"],
    platform: "node",
    target: "node22",
    // tsdown の勧めに従って束ねる依存を列挙しない。依存はすべて devDependencies に置いており、
    // 列挙から漏れたものは tarball に入らず、npx で入れた先で解決できない。
    deps: { onlyBundle: false },
    plugins: [schemaArtifact()],
  },
});
