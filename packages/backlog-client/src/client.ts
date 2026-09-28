// `import` に置き換えない理由は core の `executor.ts` にある `fetch.d.ts` の参照と同じ。
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="./abort.d.ts" />

import { Backlog } from "backlog-js";

import {
  type ExecuteContext,
  type HttpFailure,
  type ReadContext,
  type ResolvedValue,
} from "@backlog-blueprint/core";

type Configure = ConstructorParameters<typeof Backlog>[0];

type TransportParams = NonNullable<Parameters<Backlog["request"]>[0]["params"]>;

type ErrorMessages = { message: string }[];

const API_PREFIX = "/api/v2/";

const REQUEST_TIMEOUT_SECONDS = 60;

const MILLISECONDS_PER_SECOND = 1000;

/**
 * `qs` は空配列をキーごと落とすので、`applicableIssueTypes[]=`（絞りの解除）が本文に
 * 現れないまま apply が成功し、次の plan でも同じ差分が出続ける（API 制約「空配列を送る方法」）。
 */
const EMPTY_ARRAY = [""];

/**
 * core の path を相対に寄せる案は採らない。`Action.request.path` は plan の出力に
 * そのまま載る（PO-3）ので、Backlog の API ドキュメントと突き合わせられる形のままにする。
 */
const relative = (path: string): string => {
  if (!path.startsWith(API_PREFIX)) {
    throw new TypeError(`Expected an API path starting with ${API_PREFIX}, received "${path}"`);
  }

  return path.slice(API_PREFIX.length);
};

const prepared = (value: ResolvedValue): unknown => {
  if (Array.isArray(value)) {
    return value.length === 0 ? EMPTY_ARRAY : value.map((item) => prepared(item));
  }

  return value;
};

/**
 * 空配列のほかは値の形を変えない。boolean や `null` をここで文字列に畳むと、
 * `Action.request` が実際に飛ぶリクエストでなくなる（PO-3）。
 */
const prepareParams = (params: Record<string, ResolvedValue>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(params).map(([key, value]) => [key, prepared(value)]));

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

const bodyMessages = (error: Record<string, unknown>): ErrorMessages | undefined => {
  const errors = asRecord(error["body"])?.["errors"];

  if (!Array.isArray(errors) || errors.length === 0) {
    return undefined;
  }

  const messages = errors.map((entry) => asRecord(entry)?.["message"]);

  return messages.every((message) => typeof message === "string")
    ? messages.map((message) => ({ message }))
    : undefined;
};

/**
 * リクエストの本文もヘッダも載せない。API キーはヘッダにあり、足した瞬間に CI の
 * ログへ流れる経路ができる（NFR-3 / AC-10）。
 */
const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class BacklogHttpFailureError extends Error implements HttpFailure {
  readonly status?: number;

  readonly errors: ErrorMessages;

  constructor(errors: ErrorMessages, status?: number) {
    super(errors.map(({ message }) => message).join("\n"));

    this.name = "BacklogHttpFailureError";
    this.errors = errors;
    this.status = status;
  }
}

/**
 * 状態コードの無い失敗を `0` で埋めない（core §7.0）。埋めると「Backlog が拒否した」と
 * 「Backlog に届かなかった」を区別できなくなる。
 */
const toHttpFailure = (error: unknown): BacklogHttpFailureError => {
  if (error instanceof BacklogHttpFailureError) {
    return error;
  }

  const record = asRecord(error);
  const status = record?.["status"];

  if (record === undefined || typeof status !== "number") {
    return new BacklogHttpFailureError([{ message: describe(error) }]);
  }

  const described = describe(error);
  const fallback = described === "" ? `HTTP ${status}` : described;

  return new BacklogHttpFailureError(bodyMessages(record) ?? [{ message: fallback }], status);
};

export type BacklogClientOptions = {
  space: string;
  apiKey: string;
  fetch?: Configure["fetch"];
};

export type BacklogClient = {
  get: ReadContext["get"];
  send: ExecuteContext["send"];
};

/**
 * `BacklogClient` に入れない。画像を読むのは Web UI のアイコン（WU-35）だけで、入れると
 * CLI の送信層の差し替えまで使わない口を実装することになる。
 */
export type BacklogBinaryReader = {
  getBytes: (path: string) => Promise<ArrayBuffer>;
};

/**
 * `Blob` を型に書かない。このパッケージは DOM の型を読まない（NFR-5）ので、backlog-js の
 * `download()` が返す `Blob` は解決できない。
 */
type BinaryResponse = { arrayBuffer: () => Promise<ArrayBuffer> };

/** GET には2件目を足さない（X-7）。届いていても何も変えない */
const timeoutFailure = (method: string): BacklogHttpFailureError =>
  new BacklogHttpFailureError([
    { message: `No response from Backlog within ${REQUEST_TIMEOUT_SECONDS} seconds.` },
    ...(method === "GET" ? [] : [{ message: "The request may have been applied anyway." }]),
  ]);

/**
 * 型付きのエンドポイント別メソッドを使わない。本文がメソッドの実装に決められ、
 * `Action.request` が実際に飛ぶリクエストでなくなる（PO-3）。
 *
 * 429 の待機も再試行も持たない。Executor の仕事で（X-1 / X-4）、ここにも置くと待ちが
 * 二重になり、進捗の `waiting` が実態とずれる。タイムアウトも再試行しない（X-6）。
 */
export const createBacklogClient = ({
  space,
  apiKey,
  fetch,
}: BacklogClientOptions): BacklogClient & BacklogBinaryReader => {
  const transport = fetch ?? globalThis.fetch;

  /**
   * リクエストごとに作る。backlog-js の `request` は `fetch` の `init` を受け取らず、
   * `signal` を載せられるのは `fetch` を包む中だけで、1つを共有すると同時に走る取得
   * （Web UI のアイコンなど）が互いの `signal` を上書きする。
   *
   * backlog-js の `timeout` 設定は使わない。組み込みの `fetch` は無視する（X-5）。
   */
  const connect = (signal: AbortSignal): Backlog =>
    new Backlog({
      host: space,
      apiKey,
      // 包みを外さない。backlog-js は `this.fetch(url, init)` と呼び（0.20.1）、ブラウザの
      // `fetch` はレシーバが Window でないと `Illegal invocation` を投げる。Node では露見しない。
      fetch: (input, init) => transport(input, { ...init, signal }),
    });

  /**
   * `signal` だけに頼らず自前の待ちと競わせる。`signal` を無視する `fetch` の実装でも
   * 上限で返すためで、本文を読み終えるまでを `run` に含めて本文の途中で止まる接続も打ち切る。
   */
  const withinTimeout = async <T>(
    method: string,
    run: (backlog: Backlog) => Promise<T>,
  ): Promise<T> => {
    const controller = new AbortController();
    let timer: unknown;

    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(timeoutFailure(method));
        controller.abort();
      }, REQUEST_TIMEOUT_SECONDS * MILLISECONDS_PER_SECOND);
    });

    try {
      return await Promise.race([run(connect(controller.signal)), timedOut]);
    } catch (error) {
      throw toHttpFailure(error);
    } finally {
      clearTimeout(timer);
    }
  };

  const call = (method: string, path: string, params: Record<string, unknown>): Promise<unknown> =>
    withinTimeout(method, async (backlog) => {
      // 型に合わせて値を畳まない。backlog-js の `Params` は数値と文字列しか認めないが、
      // シリアライズする `qs` は boolean も `null` も扱い、畳んだ側が本文を決めることになる。
      const response = await backlog.request({
        method,
        path,
        params: params as TransportParams,
      });

      return await backlog.parseJSON(response);
    });

  return {
    // 404 を `undefined` に読み替えない（core §7.0）。どの 404 が情報かを知っているのは core。
    get: (path) => call("GET", relative(path), {}),
    getBytes: (path) =>
      withinTimeout("GET", async (backlog) => {
        const response: BinaryResponse = await backlog.request({
          method: "GET",
          path: relative(path),
          params: {},
        });

        return await response.arrayBuffer();
      }),
    send: ({ method, path, params }) => call(method, relative(path), prepareParams(params)),
  };
};
