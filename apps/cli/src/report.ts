import { toHttpFailure } from "@backlog-blueprint/backlog-client";

import { type Action } from "@backlog-blueprint/core";

/**
 * 失敗の中身だけを書き、リクエストの本文もヘッダも書かない。API キーは
 * ヘッダにしか存在しないので、ここに要求の中身を足した瞬間に CI のログへ
 * 流れる経路ができる（NFR-3 / AC-10）。
 */
export const errorReport = (error: unknown): string => {
  const { status, errors } = toHttpFailure(error);
  const prefix = status === undefined ? "" : `${status}  `;

  return errors.map(({ message }) => `ERROR  ${prefix}${message}\n`).join("");
};

/** 差分の有無は `writeRequest: true` の Action 数で決まる（plan の出力仕様 §1.3） */
export const writeRequestCount = (actions: Action[]): number =>
  actions.filter(({ writeRequest }) => writeRequest).length;
