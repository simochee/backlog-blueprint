import { Secret } from "../secret";
import { type Ref, type Value } from "../value";
import { WEBHOOK_EVENTS } from "../webhook-events";

const NONE = "(none)";

const EVENT_DESCRIPTIONS: ReadonlyMap<number, string> = new Map(
  WEBHOOK_EVENTS.map(({ id, description }) => [id, description]),
);

export const isRef = (value: Value): value is Ref =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Secret) &&
  "$ref" in value;

/**
 * 名前を落として数値だけにしない（W-5）。表に無い ID は Backlog が増やした新しい
 * イベントで、名前が引けないことと未知の値であることは区別できない。
 */
export const webhookEventLabel = (id: number): string => {
  const description = EVENT_DESCRIPTIONS.get(id);

  return description === undefined ? String(id) : `${id} (${description})`;
};

export type ValueFormat = { describeNumber?: (value: number) => string };

export const formatValue = (value: Value | null | undefined, format: ValueFormat = {}): string => {
  if (value === null || value === undefined) {
    return NONE;
  }

  if (Array.isArray(value)) {
    return value.map((item) => formatValue(item, format)).join(", ");
  }

  if (value instanceof Secret) {
    return String(value);
  }

  if (isRef(value)) {
    return `<${value.$ref.kind} "${value.$ref.name}" (to be created)>`;
  }

  if (typeof value === "number") {
    return format.describeNumber === undefined ? String(value) : format.describeNumber(value);
  }

  if (typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
};

/**
 * `Secret` どうしを描画結果で比べない。どちらも `***` になるので、hookUrl が
 * 書き換わる変更を「同じ値」と見なして描かなくなる。`reveal()` を呼んでよい
 * 差分判定にあたる（`Secret` の定義）。
 */
export const sameValue = (
  left: Value | null | undefined,
  right: Value | null | undefined,
): boolean => {
  if (left instanceof Secret || right instanceof Secret) {
    return left instanceof Secret && right instanceof Secret && left.reveal() === right.reveal();
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameValue(item, right[index]))
    );
  }

  if (
    left !== null &&
    left !== undefined &&
    right !== null &&
    right !== undefined &&
    isRef(left) &&
    isRef(right)
  ) {
    return left.$ref.kind === right.$ref.kind && left.$ref.name === right.$ref.name;
  }

  return (left ?? null) === (right ?? null);
};
