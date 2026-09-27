/**
 * core の `fetch.d.ts` が写す面に足すのは、X-5 の打ち切りに要る2つだけにする。
 * `lib` に `DOM` を足す案と `@types/node` を読む案は、core と同じ理由で採らない。
 * このパッケージもブラウザで動くので、どちらも Node とブラウザの両方にあるものに限る。
 * `clearTimeout` が無いと、応答が間に合ったリクエストの待ちが残り、CLI が
 * 最後の応答から上限の時間だけ終了しなくなる。
 */

interface AbortController {
  readonly signal: AbortSignal;
  abort(): void;
}

declare const AbortController: new () => AbortController;

declare function clearTimeout(timer: unknown): void;
