/**
 * 送信層から返る値は core にとって外部入力である（要件定義 §7.0）。`as` で名乗らせると、
 * 形の違う応答がスナップショットの奥まで届き、差分算出の途中で `undefined` として
 * 現れる。どのリソースの取得で壊れたのかも分からなくなるので、取り込む場所で落とす。
 */
const fail = (detail: string): never => {
  throw new TypeError(`Unexpected Backlog API response: ${detail}`);
};

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
 * `null` を `undefined` に寄せる。Backlog は未設定を `null` で返し、マニフェスト側の
 * 未記述は `undefined` である。K-3 が「省略は比較にも送信にも載せない」と決めている以上、
 * 取り込む時点で1つに寄せないと、同じ「未設定」が2つの値で現れる。
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

export const optionalStrings = (
  record: Record<string, unknown>,
  field: string,
): string[] | undefined => {
  const value = record[field];

  if (value === undefined || value === null) {
    return undefined;
  }

  return asArrayOf(value, (item) =>
    typeof item === "string" ? item : fail(`"${field}" must contain strings only`),
  );
};

/**
 * 数値型の `min` / `max` と日付型の `min` / `max` はキー名が同じで型が違う
 * （API 制約）。どちらで返ってきたかを取り込む側で決めない。
 */
export const numberOrString = (
  record: Record<string, unknown>,
  field: string,
): number | string | undefined => {
  const value = record[field];

  if (value === undefined || value === null) {
    return undefined;
  }

  return typeof value === "number" || typeof value === "string"
    ? value
    : fail(`"${field}" must be a number or a string`);
};
