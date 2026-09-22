import react from "@vitejs/plugin-react";
import { projectSchemaArtifact } from "@backlog-blueprint/schema";
import { type Plugin } from "vite";
import { defineConfig } from "vitest/config";

import cliPackage from "../cli/package.json";

/**
 * 書き出しをここに置くのは、Node が使えて、かつ `packages/core` と
 * `packages/schema` にプラットフォーム依存を入れずに済む場所だから（NFR-5）。
 * 要件定義 §7.1 の配布構成でも、JSON Schema は Web UI と同じ Pages のルートに並ぶ。
 *
 * バージョンを npm パッケージの package.json から読むのは D-2 による。
 * ルートの package.json は private で版を持たないので、npm に出る
 * `@simochee/backlog-blueprint` の版と一致しない。
 *
 * この設定を読むコマンドはすべて `--configLoader runner` を付ける（`dev` / `build` /
 * `test`）。既定のローダはこのファイルを esbuild で束ねたうえで、ワークスペースの
 * パッケージを external にして Node に読ませる。core は相対 import に拡張子を
 * 書かない決まり（AGENTS.md）なので、Node の ESM 解決では読めない。
 * 相対 path で `packages/schema/src` を直に読む案は、既定のローダで動く代わりに
 * パッケージの公開面（B-1）を迂回するので採らない。
 */
const schemaArtifact = (): Plugin => ({
  name: "backlog-blueprint:schema",
  generateBundle() {
    const { path, contents } = projectSchemaArtifact(cliPackage.version);

    this.emitFile({ type: "asset", fileName: path, source: contents });
  },
});

/**
 * 畳めなかったことを黙って見逃さない（WU-19）。既定では畳めない部品をそのまま素通しに
 * するので、`for await` を1つ書き足しただけで、それを抱えている部品ごと最適化から外れる。
 * 外れたことは動かしても分からない — 遅くなるだけで壊れないからである。落とせば分かる。
 */
const reactCompiler: [string, { panicThreshold: string }] = [
  "babel-plugin-react-compiler",
  { panicThreshold: "all_errors" },
];

/** GitHub Pages のサブパス配信（要件定義 §7.1 / WU-2） */
const BASE = "/backlog-blueprint/";

export default defineConfig({
  base: BASE,
  define: { __SCHEMA_VERSION__: JSON.stringify(cliPackage.version) },
  plugins: [react({ babel: { plugins: [reactCompiler] } }), schemaArtifact()],
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
