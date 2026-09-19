import { defineConfig } from "vite";

/**
 * 依存をすべて束ねる。`packages/core` と `packages/backlog-client` は TypeScript の
 * ソースを `exports` にしている（B-1）ので、external にすると `dist` が
 * `.ts` を import する形になって Node が読めない。相対 import に拡張子を書かない
 * 決まり（AGENTS.md）も、Node の ESM 解決では成立しない。
 *
 * `--configLoader runner` が要るのも同じ理由で、既定のローダはワークスペースの
 * パッケージを external にして Node に読ませる（apps/web/vite.config.ts と同じ）。
 *
 * shebang は `src/main.ts` が持つ。ここで `banner` を足すと2行になる。
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
  ssr: { noExternal: true },
});
