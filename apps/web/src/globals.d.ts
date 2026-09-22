/**
 * ビルド時に `apps/cli/package.json` の版が埋め込まれる（vite.config.ts）。
 * スキーマの URL の版は npm の版と同じ番号でなければならない（D-2）ので、
 * 実行時に別の出所から取らない。
 */
declare const __SCHEMA_VERSION__: string;
