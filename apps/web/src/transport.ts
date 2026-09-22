import { createBacklogClient, type BacklogClient } from "@backlog-blueprint/backlog-client";

/**
 * API キーを内包するクライアントも React の state に載せない（§2.4 / FR-7.4）。
 * 「API キーを持つものはモジュールスコープにしかない」と言い切れれば grep で確かめられる
 * ので、表示も永続化もしないから state でよい、という例外を作らない。
 * 接続が有効かどうかは、値ではなく印だけを state に置けば表せる。
 */
let client: BacklogClient | undefined;

const opened = (): BacklogClient => {
  if (client === undefined) {
    throw new TypeError("No Backlog connection has been opened.");
  }

  return client;
};

/**
 * 繋ぐ前の候補は採用するまで `transport` に入れない（WU-36）。先に入れると、切り替えの
 * モーダルで V-B2 に落ちた接続が、今の接続の代わりに一覧や計画の取得に使われる。
 */
export const candidateTransport = (space: string, apiKey: string): BacklogClient =>
  createBacklogClient({ space, apiKey });

export const adoptTransport = (candidate: BacklogClient): void => {
  client = candidate;
};

export const closeTransport = (): void => {
  client = undefined;
};

/** WU-37。適用は始めた時点のクライアントを最後まで使う。 */
export const pinTransport = (): BacklogClient => opened();

export const transport: BacklogClient = {
  get: (path) => opened().get(path),
  send: (request) => opened().send(request),
};
