import { projectSchemaArtifact } from "@backlog-blueprint/schema";
import { defineConfig, type Plugin } from "vite";

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

export default defineConfig({
  base: "./",
  plugins: [schemaArtifact()],
});
