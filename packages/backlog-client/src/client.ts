import { Backlog } from "backlog-js";

import { type ExecuteContext, type ReadContext } from "@backlog-blueprint/core";

import { toHttpFailure } from "./failure";
import { prepareParams } from "./params";

type Configure = ConstructorParameters<typeof Backlog>[0];

type TransportParams = NonNullable<Parameters<Backlog["request"]>[0]["params"]>;

const API_PREFIX = "/api/v2/";

/**
 * backlog-js は `https://<host>/api/v2/<path>` を組み立てるので、core が持つ
 * 絶対 path から接頭辞を外す。core 側を相対 path に寄せる案は採らない。
 * `Action.request.path` は plan の出力にそのまま載る（PO-3）ので、
 * 読み手が Backlog の API ドキュメントと突き合わせられる形のままにする。
 */
const relative = (path: string): string => {
  if (!path.startsWith(API_PREFIX)) {
    throw new TypeError(`Expected an API path starting with ${API_PREFIX}, received "${path}"`);
  }

  return path.slice(API_PREFIX.length);
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
 * `BacklogClient` に入れない。core の reconciler と Executor が使うのは JSON を返す口だけで、
 * 画像を読むのは Web UI のアイコン（WU-35）だけである。入れると CLI の送信層の差し替えまで
 * 使わない口を実装することになる。
 */
export type BacklogBinaryReader = {
  /** 画像などの本文をバイト列のまま返す。API キーは他の取得と同じくヘッダで送る */
  getBytes: (path: string) => Promise<ArrayBuffer>;
};

/**
 * `Blob` を型に書かない。このパッケージは DOM の型を読まない（NFR-5）ので、backlog-js の
 * `download()` が返す `Blob` は型として解決できない。`ArrayBuffer` は ES2022 にある。
 */
type BinaryResponse = { arrayBuffer: () => Promise<ArrayBuffer> };

/**
 * 型付きのエンドポイント別メソッドを使わない。`request` 以外を経由すると、
 * 送られる本文がメソッドの実装に決められ、`Action.request` が「実際に飛ぶ
 * リクエスト」でなくなる（PO-3）。
 *
 * 429 の待機も再試行も持たない。間隔と再試行は Executor の仕事（X-1 / X-4）で、
 * ここにも置くと待ち時間が二重になり、進捗の `waiting` が実態とずれる。
 */
export const createBacklogClient = ({
  space,
  apiKey,
  fetch,
}: BacklogClientOptions): BacklogClient & BacklogBinaryReader => {
  /**
   * backlog-js は渡した関数を `this.fetch = ...` に置き、`this.fetch(url, init)` と
   * 呼ぶ（0.20.1)。ブラウザの `fetch` はレシーバが Window でないと
   * `Illegal invocation` を投げるので、そのままでは Web UI からの通信が全て失敗する。
   * Node の fetch は `this` を見ないため CLI では露見しない。
   * この包みはレシーバを捨てるためだけにあり、外すと Web UI が壊れる。
   */
  const transport = fetch ?? globalThis.fetch;
  const backlog = new Backlog({
    host: space,
    apiKey,
    fetch: (input, init) => transport(input, init),
  });

  const call = async (
    method: string,
    path: string,
    params: Record<string, unknown>,
  ): Promise<unknown> => {
    try {
      /**
       * backlog-js の `Params` は数値と文字列とその配列しか認めないが、実際の
       * シリアライズは `qs` が行い、boolean も `null` も入れ子の配列も扱える。
       * 型に合わせて値を畳むと、畳んだ側が本文のバイト列を決めることになる。
       */
      const response = await backlog.request({
        method,
        path,
        params: params as TransportParams,
      });

      return await backlog.parseJSON(response);
    } catch (error) {
      throw toHttpFailure(error);
    }
  };

  return {
    /**
     * 404 を `undefined` に読み替えない（§7.0）。存在しないプロジェクトを情報として
     * 読むのはフェーズ0だけで、どの 404 が情報かを知っているのは core の側である。
     */
    get: (path) => call("GET", relative(path), {}),
    getBytes: async (path) => {
      try {
        const response: BinaryResponse = await backlog.request({
          method: "GET",
          path: relative(path),
          params: {},
        });

        return await response.arrayBuffer();
      } catch (error) {
        throw toHttpFailure(error);
      }
    },
    send: ({ method, path, params }) => call(method, relative(path), prepareParams(params)),
  };
};
