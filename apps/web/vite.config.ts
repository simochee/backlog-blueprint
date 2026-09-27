import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import cliPackage from "../cli/package.json";

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
  plugins: [react({ babel: { plugins: [reactCompiler] } })],
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/test-setup.ts"],
    // codemirror-json-schema を外部モジュールのまま Node に読ませない。ESM が拡張子の無い
    // 相対 import で書かれていて解決できない。ブラウザ向けのビルドは Vite が束ねるので困らない。
    server: { deps: { inline: ["codemirror-json-schema"] } },
  },
});
