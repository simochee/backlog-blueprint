/**
 * 応答を `as` で名乗らせない。形の違う応答が差分算出の途中で `undefined` として現れ、
 * どの取得で壊れたのかも分からなくなる（要件定義 §7.0）。
 */
const fail = (detail: string): never => {
  throw new TypeError(`Unexpected Backlog API response: ${detail}`);
};

/**
 * `status` を `0` などで埋めない。タイムアウトや CORS の失敗には状態コードが無く、埋めると
 * 消費側が「Backlog が拒否した」と「Backlog に届かなかった」を区別できない（§7.0 / PO-7）。
 */
export type HttpFailure = {
  status?: number;
  errors: { message: string }[];
};

/**
 * `asRecord` で置き換えない。エラー本文やレート制限の本文の形が違ったときに投げると、
 * API の失敗を報告する経路自体が別の例外で置き換わる。
 */
export const looseRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

export const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : fail("expected an array");

export const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("expected an object");
  }

  return value as Record<string, unknown>;
};

export const asArrayOf = <Item>(value: unknown, decode: (item: unknown) => Item): Item[] =>
  asArray(value).map((item) => decode(item));

export const requiredNumber = (record: Record<string, unknown>, field: string): number => {
  const value = record[field];

  return typeof value === "number" ? value : fail(`"${field}" must be a number`);
};

export const requiredString = (record: Record<string, unknown>, field: string): string => {
  const value = record[field];

  return typeof value === "string" ? value : fail(`"${field}" must be a string`);
};

/**
 * Backlog の未設定（`null`）をマニフェストの未記述（`undefined`）に寄せる。寄せないと
 * 同じ「未設定」が2つの値で現れ、K-3 の省略判定がずれる。
 */
export const optionalString = (
  record: Record<string, unknown>,
  field: string,
): string | undefined => {
  const value = record[field];

  if (value === undefined || value === null) {
    return undefined;
  }

  return typeof value === "string" ? value : fail(`"${field}" must be a string`);
};

export const optionalNumber = (
  record: Record<string, unknown>,
  field: string,
): number | undefined => {
  const value = record[field];

  if (value === undefined || value === null) {
    return undefined;
  }

  return typeof value === "number" ? value : fail(`"${field}" must be a number`);
};

export const optionalBoolean = (
  record: Record<string, unknown>,
  field: string,
): boolean | undefined => {
  const value = record[field];

  if (value === undefined || value === null) {
    return undefined;
  }

  return typeof value === "boolean" ? value : fail(`"${field}" must be a boolean`);
};

export const requiredBoolean = (record: Record<string, unknown>, field: string): boolean => {
  const value = record[field];

  return typeof value === "boolean" ? value : fail(`"${field}" must be a boolean`);
};

export const numbers = (record: Record<string, unknown>, field: string): number[] => {
  const value = record[field];

  if (value === undefined || value === null) {
    return [];
  }

  return asArrayOf(value, (item) =>
    typeof item === "number" ? item : fail(`"${field}" must contain numbers only`),
  );
};

/**
 * 時刻付きの日付をそのまま持たない。同じ日付でも毎回 update が出て NFR-4 が崩れる。
 * マニフェストが書けるのは `yyyy-MM-dd` だけ（Y-1）なので、切り詰めても失うものは無い。
 */
const dateOnly = (value: string): string => value.slice(0, 10);

export const optionalDate = (
  record: Record<string, unknown>,
  field: string,
): string | undefined => {
  const value = optionalString(record, field);

  return value === undefined ? undefined : dateOnly(value);
};

/**
 * 数値か日付かを取り込む側で決めない。数値型と日付型の `min` / `max` はキー名が同じで
 * 型が違う（API 制約）。
 */
export const numberOrDate = (
  record: Record<string, unknown>,
  field: string,
): number | string | undefined => {
  const value = record[field];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "string") {
    return dateOnly(value);
  }

  return typeof value === "number" ? value : fail(`"${field}" must be a number or a string`);
};
