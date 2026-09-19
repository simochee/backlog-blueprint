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
