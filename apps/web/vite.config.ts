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

/** GitHub Pages のサブパス配信（要件定義 §7.1 / WU-2） */
const BASE = "/backlog-blueprint/";

/**
 * `@vitejs/plugin-react` を読み込まない。導入済みの 6.1.1 は peer に vite ^8 を要求し、
 * `vite/internal` を import するため vite 7 では設定の読み込み自体が落ちる（実測）。
 * JSX は vite の esbuild が tsconfig の `jsx: react-jsx` を見て変換するので、
 * 変換だけなら plugin は要らない。plugin が戻せるのは開発時の Fast Refresh である。
 */
export default defineConfig({
  base: BASE,
  plugins: [schemaArtifact()],
});
