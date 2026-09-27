/**
 * core の `fetch.d.ts` の面に足すのは X-5 の打ち切りに要るものだけにする。`lib` に `DOM` を
 * 足す案と `@types/node` を読む案は、core と同じ理由（NFR-5）で採らない。
 */
interface AbortController {
  readonly signal: AbortSignal;
  abort(): void;
}

declare const AbortController: new () => AbortController;

declare function clearTimeout(timer: unknown): void;
