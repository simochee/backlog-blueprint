import react from "@vitejs/plugin-react";
import { projectSchemaArtifact } from "@backlog-blueprint/schema";
import { type Plugin } from "vite";
import { defineConfig } from "vitest/config";

import cliPackage from "../cli/package.json";

/**
 * スキーマの書き出しを `packages/schema` に置かない。ファイルを書くには Node が要り、
 * プラットフォーム依存が入る（NFR-5）。版をルートの package.json から読まないのは、
 * private で版を持たず npm に出る版と一致しないため（D-2）。
 *
 * この設定を読むコマンドには `--configLoader runner` を付ける。既定のローダはワークスペースの
 * パッケージを external にして Node に読ませるが、core の相対 import には拡張子が無く、
 * Node の ESM 解決では読めない。`packages/schema/src` を相対 path で読めば既定のローダで
 * 動くが、パッケージの公開面（B-1）を迂回するので採らない。
 */
const schemaArtifact = (): Plugin => ({
  name: "backlog-blueprint:schema",
  generateBundle() {
    const { path, contents } = projectSchemaArtifact(cliPackage.version);

    this.emitFile({ type: "asset", fileName: path, source: contents });
  },
});

/**
 * 既定の閾値に戻さない（WU-19）。既定では畳めない部品を素通しにするので、`for await` を
 * 1つ書き足しただけで部品ごと最適化から外れ、遅くなるだけで壊れないので誰も気付かない。
 */
const reactCompiler: [string, { panicThreshold: string }] = [
  "babel-plugin-react-compiler",
  { panicThreshold: "all_errors" },
];

const BASE = "/backlog-blueprint/";

export default defineConfig({
  base: BASE,
  define: { __SCHEMA_VERSION__: JSON.stringify(cliPackage.version) },
  plugins: [react({ babel: { plugins: [reactCompiler] } }), schemaArtifact()],
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/test-setup.ts"],
    // codemirror-json-schema を外部モジュールのまま Node に読ませない。ESM が拡張子の無い
    // 相対 import で書かれていて解決できない。ブラウザ向けのビルドは Vite が束ねるので困らない。
    server: { deps: { inline: ["codemirror-json-schema"] } },
  },
});
