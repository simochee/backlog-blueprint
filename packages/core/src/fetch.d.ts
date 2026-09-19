/**
 * `lib` に `DOM` を足す案と `@types/web` を入れる案は採らない。どちらも
 * `document` / `localStorage` / `window` まで型が通り、core の本体から
 * ランタイム固有の API を締め出すガード（NFR-5）が緩む。とくに `localStorage` を
 * 引ける状態は、API キーを永続化しないこと（FR-7.4）を型で見張れなくする。
 * 代わりに、実際に使う面だけをここに写す。
 *
 * `FetchResponse` にヘッダを持たせないのは X-3 による。レート制限の残量は常に
 * `GET /rateLimit` の本文から取る決まりで、ブラウザは `access-control-expose-headers`
 * が返らずヘッダを読めない。読める型を置くと、Node でだけ動く経路を書けてしまう。
 */

interface FetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

interface FetchInit {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

declare function fetch(input: string, init?: FetchInit): Promise<FetchResponse>;

interface AbortSignal {
  readonly aborted: boolean;
}

declare const AbortSignal: {
  timeout(milliseconds: number): AbortSignal;
};

/**
 * 戻り値を `unknown` にしておく。Node は `Timeout` オブジェクトを、ブラウザは数値を
 * 返す。どちらかの型に決めると、決めた側でしか `clearTimeout` を書けない形になる。
 * NFR-5 が許すのは X-1 / X-4 の待機に要る呼び出しだけなので、`clearTimeout` は
 * 宣言しない。
 */
declare function setTimeout(callback: () => void, milliseconds: number): unknown;
