import {
  createBacklogClient,
  type BacklogBinaryReader,
  type BacklogClient,
} from "@backlog-blueprint/backlog-client";

type WebClient = BacklogClient & BacklogBinaryReader;

/**
 * API キーを内包するクライアントも React の state に載せない（§2.4 / FR-7.4）。
 * 表示も永続化もしないから state でよい、という例外を作ると、「API キーを持つものは
 * モジュールスコープにしかない」を grep で確かめられなくなる。
 */
let client: WebClient | undefined;

const opened = (): WebClient => {
  if (client === undefined) {
    throw new TypeError("No Backlog connection has been opened.");
  }

  return client;
};

/**
 * 繋ぐ前の候補は採用するまで `transport` に入れない（WU-36）。先に入れると、切り替えの
 * モーダルで V-B1 に落ちた接続が、今の接続の代わりに一覧や計画の取得に使われる。
 */
export const candidateTransport = (space: string, apiKey: string): WebClient =>
  createBacklogClient({ space, apiKey });

export const adoptTransport = (candidate: WebClient): void => {
  client = candidate;
};

export const closeTransport = (): void => {
  client = undefined;
};

/** 適用に `transport` を渡さない。途中で繋ぎ直すと、残りの書き込みが別のスペースへ行く（WU-37）。 */
export const pinTransport = (): BacklogClient => opened();

export const transport: WebClient = {
  get: (path) => opened().get(path),
  send: (request) => opened().send(request),
  getBytes: (path) => opened().getBytes(path),
};
