/**
 * 投げられたものが `HttpFailure`（§7.0）である保証は型にできない。送信層は core の外に
 * あり（B-2）、通信そのものが成立しなかった失敗では別の例外が上がる。形が違えば
 * 読めたところまでで組み直し、無い値は無いまま扱う。
 */
const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

export const failureStatus = (error: unknown): number | undefined => {
  const status = record(error)?.["status"];

  return typeof status === "number" ? status : undefined;
};

const messagesOf = (error: unknown): string[] | undefined => {
  const errors = record(error)?.["errors"];

  if (!Array.isArray(errors)) {
    return undefined;
  }

  const messages = errors.map((item) => record(item)?.["message"]);

  return messages.every((message) => typeof message === "string") ? messages : undefined;
};

export const failureDetail = (error: unknown): string =>
  messagesOf(error)?.join(", ") ?? String(record(error)?.["message"] ?? error);

export const failureErrors = (error: unknown): { message: string }[] =>
  (messagesOf(error) ?? [failureDetail(error)]).map((message) => ({ message }));
