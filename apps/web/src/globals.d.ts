/**
 * ビルド時に `apps/cli/package.json` の版が埋め込まれる（vite.config.ts）。
 * スキーマの URL の版は npm の版と同じ番号でなければならない（D-2）ので、
 * 実行時に別の出所から取らない。
 */
declare const __SCHEMA_VERSION__: string;

/**
 * Vite の `?worker` を型として知らせる。`vite/client` を `types` に足す案は採らない。
 * あれは `import.meta.env` や各種アセットの宣言まで連れてくるので、この 1 つの
 * ために面が広がる。
 */
declare module "*?worker" {
  const WorkerConstructor: new () => Worker;

  export default WorkerConstructor;
}

/**
 * monaco-editor 0.52 の型はこの global を宣言しない（後の版で入った）。
 * 使う面だけを写す。`var` なのは `globalThis` への代入を許すため。
 */
declare var MonacoEnvironment:
  | { getWorker: (workerId: string, label: string) => Worker }
  | undefined;
