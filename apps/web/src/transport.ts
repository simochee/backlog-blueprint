import { createBacklogClient, type BacklogClient } from "@backlog-blueprint/backlog-client";

import { revealApiKey } from "./secrets";

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

export const openTransport = (space: string): void => {
  client = createBacklogClient({ space, apiKey: revealApiKey() });
};

export const transport: BacklogClient = {
  get: (path) => opened().get(path),
  send: (request) => opened().send(request),
};
