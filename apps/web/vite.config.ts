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
 * `package.json` の script に `--configLoader runner` が要る。既定のローダは
 * この設定ファイルを esbuild で束ねたうえで、ワークスペースのパッケージを
 * external にして Node に読ませる。core は相対 import に拡張子を書かない決まり
 * （AGENTS.md）なので、Node の ESM 解決では読めない。
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
