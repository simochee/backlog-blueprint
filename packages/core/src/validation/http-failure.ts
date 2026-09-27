import { type HttpFailure, looseRecord } from "../api-response";

const messagesOf = (error: unknown): { message: string }[] | undefined => {
  const errors = looseRecord(error)?.["errors"];

  if (!Array.isArray(errors)) {
    return undefined;
  }

  const messages = errors.map((item) => looseRecord(item)?.["message"]);

  return messages.every((message) => typeof message === "string")
    ? messages.map((message) => ({ message }))
    : undefined;
};

/**
 * 投げられたものを `HttpFailure`（§7.0）と決めつけない。送信層は core の外にあり（B-2）、
 * 通信が成立しなかった失敗では別の例外が上がる。
 */
export const toHttpFailure = (error: unknown): HttpFailure => {
  const status = looseRecord(error)?.["status"];
  const errors = messagesOf(error) ?? [
    { message: String(looseRecord(error)?.["message"] ?? error) },
  ];

  return typeof status === "number" ? { status, errors } : { errors };
};

export const failureStatus = (error: unknown): number | undefined => toHttpFailure(error).status;

export const failureDetail = (error: unknown): string =>
  toHttpFailure(error)
    .errors.map(({ message }) => message)
    .join(", ");
