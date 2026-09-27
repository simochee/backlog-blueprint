/**
 * `lib` に `DOM` を足す案と `@types/web` を入れる案は採らない。`document` や `localStorage` まで
 * 型が通り、NFR-5 のガードも、API キーを永続化しないこと（FR-7.4）の見張りも緩む。
 *
 * `FetchResponse` にヘッダを持たせない。ブラウザでは `X-RateLimit-*` を読めず、Node でだけ
 * 動く経路を書けてしまう（X-3）。
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
 * 戻り値を Node の `Timeout` にもブラウザの数値にも決めない。決めた側でしか動かない
 * `clearTimeout` を書けてしまう。`clearTimeout` 自体も、X-1 / X-4 の待機に要らないので宣言しない。
 */
declare function setTimeout(callback: () => void, milliseconds: number): unknown;
