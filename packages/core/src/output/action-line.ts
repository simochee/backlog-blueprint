import { type Action } from "../action";
import { type Op, type ResourceKind } from "../resource";
import { type Value } from "../value";
import { type Paint, styleOf } from "./color";
import { formatValue, sameValue, type ValueFormat, webhookEventLabel } from "./value";

const SYMBOLS: Record<Op, string> = {
  create: "+",
  update: "~",
  reorder: "~",
  delete: "-",
  noop: "=",
  refresh: "↻",
};

const LABEL_WIDTH = 15;

const REFRESH_DETAIL = "reading back default issue types and statuses";

const UNUSED_DEFAULT = "(unused default)";

/**
 * 値の桁でも整列しない。日本語の文字幅で崩れるため表形式を採らなかった（PO-8）
 * 判断が、そのまま名前より右の桁にも当てはまる。
 */
const CELL_SEPARATOR = "  ";

type Highlight = { field: string; label?: string };

/**
 * `create` にだけ添える。`update` は下に `field: before -> after` が並ぶので、
 * 同じ値を2度描くことになる（§1.1 の `~ issueType "調査"` は色を添えていない）。
 */
const HIGHLIGHTS: Partial<Record<ResourceKind, Highlight[]>> = {
  project: [{ field: "name" }],
  issueType: [{ field: "color", label: "color" }],
  status: [{ field: "color", label: "color" }],
  webhook: [{ field: "hookUrl", label: "hookUrl" }],
};

const valueFormat = (action: Action, field: string): ValueFormat =>
  action.kind === "webhook" && field === "events" ? { describeNumber: webhookEventLabel } : {};

const label = (action: Action): string => {
  if (action.op === "refresh") {
    return "refresh";
  }

  return action.op === "reorder" ? `${action.kind}Order` : action.kind;
};

const labelColumn = (action: Action): string => {
  const text = label(action);

  return text.length < LABEL_WIDTH ? text.padEnd(LABEL_WIDTH) : `${text} `;
};

/**
 * 枠の位置（`Action.name` の数字）を見せない。利用者は初期状態にあるものを
 * 認識しなくてよい（core のデータモデル §4.1）。
 */
const isUnusedDefaultSlot = (action: Action): boolean =>
  action.target !== undefined &&
  typeof action.target !== "number" &&
  action.target.$ref.kind === "issueTypeSlot";

const orderCell = (action: Action): string => {
  const after = action.changes?.[0]?.after;

  return Array.isArray(after)
    ? after.map((item) => (typeof item === "string" ? item : formatValue(item))).join(", ")
    : "";
};

export type LineVariant = "plan" | "progress" | "summary";

const nameCell = (action: Action, variant: LineVariant): string => {
  if (action.op === "refresh") {
    return variant === "summary" ? "" : REFRESH_DETAIL;
  }

  if (action.op === "reorder") {
    return orderCell(action);
  }

  if (isUnusedDefaultSlot(action)) {
    return UNUSED_DEFAULT;
  }

  return action.kind === "project" ? action.name : JSON.stringify(action.name);
};

const highlights = (action: Action): string[] => {
  const params = action.request?.params;

  if (action.op !== "create" || params === undefined) {
    return [];
  }

  return (HIGHLIGHTS[action.kind] ?? []).flatMap(({ field, label: fieldLabel }) => {
    const value = params[field];

    if (value === undefined) {
      return [];
    }

    const formatted = formatValue(value, valueFormat(action, field));

    return [fieldLabel === undefined ? formatted : `${fieldLabel} ${formatted}`];
  });
};

/**
 * 新規プロジェクトの枠の引き継ぎに `renamed from` は付かない。`notes` を持つのは
 * 利用者が `oldname` を書いた場合だけである（PO-1）。
 */
const notes = (action: Action): string[] =>
  (action.notes ?? []).map(({ from }) => `renamed from ${JSON.stringify(from)}`);

export const actionLine = (action: Action, variant: LineVariant, paint: Paint): string => {
  const cells =
    variant === "plan"
      ? [nameCell(action, variant), ...highlights(action), ...notes(action)]
      : [nameCell(action, variant)];
  const body = `${SYMBOLS[action.op]} ${labelColumn(action)}${cells.filter((cell) => cell !== "").join(CELL_SEPARATOR)}`;

  return paint(styleOf(action.op), body.trimEnd());
};

const changeLine = (
  action: Action,
  field: string,
  before: Value | null,
  after: Value | null,
): string => {
  const format = valueFormat(action, field);

  return `${field}: ${formatValue(before, format)} -> ${formatValue(after, format)}`;
};

/**
 * 改名された `name` を変更行に出さない。行に添えた `renamed from "X"` と同じことを
 * 2度書くことになる（§1.1 の `~ issueType "調査"` に変更行が無い）。
 */
const isRenamedName = (action: Action, field: string): boolean =>
  field === "name" && (action.notes ?? []).some(({ type }) => type === "renamed");

/**
 * 変わらない項目を描かない（§1.2）。`changes` がリクエストに載る全フィールドを
 * 持つ（PO-11）のは JSON の約束なので、絞るのは描画側の仕事になる。
 */
export const changeLines = (action: Action): string[] =>
  action.op === "update"
    ? (action.changes ?? [])
        .filter(
          ({ field, before, after }) => !sameValue(before, after) && !isRenamedName(action, field),
        )
        .map(({ field, before, after }) => changeLine(action, field, before, after))
    : [];
