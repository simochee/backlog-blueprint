import { defineConfig } from "vite";

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
  ssr: { noExternal: true },
});
