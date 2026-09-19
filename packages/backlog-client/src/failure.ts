import { type HttpFailure } from "@backlog-blueprint/core";

type ErrorMessages = { message: string }[];

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
 * リクエストの本文もヘッダも載せない。API キーはヘッダにしか存在せず、ここに
 * リクエストの中身を足した瞬間に CI のログへ流れる経路ができる（NFR-3 / AC-10）。
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
 * 状態コードを持たない失敗に `0` を入れない（§7.0）。タイムアウト・名前解決の失敗・
 * ブラウザの CORS 失敗では HTTP のやり取りが成立しておらず、埋めると受け手が
 * 「Backlog が拒否した」と「Backlog に届かなかった」を区別できなくなる。
 */
export const toHttpFailure = (error: unknown): BacklogHttpFailureError => {
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
