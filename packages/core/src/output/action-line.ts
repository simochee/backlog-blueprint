import { type Action } from "../action";
import { type Op, type ResourceKind } from "../resource";
import { sameValue, type Value } from "../value";
import { type Paint, styleOf } from "./color";
import { formatValue, type ValueFormat, webhookEventLabel } from "./value";

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

/** 値の桁で整列しない。日本語の文字幅で崩れる（PO-8） */
const CELL_SEPARATOR = "  ";

type Highlight = { field: string; label?: string };

/** `update` には添えない。下に並ぶ `field: before -> after` と同じ値を2度描く（§1.1） */
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

/** 枠の位置（`Action.name` の数字）を見せない。利用者は初期状態を認識しなくてよい（core §4.1） */
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

/** 改名された `name` を変更行に出さない。行に添えた `renamed from "X"` と2度書くことになる（§1.1） */
const isRenamedName = (action: Action, field: string): boolean =>
  field === "name" && (action.notes ?? []).some(({ type }) => type === "renamed");

/** `changes` の側では絞らない。全フィールドを持つのは JSON の約束（PO-11） */
export const changeLines = (action: Action): string[] =>
  action.op === "update"
    ? (action.changes ?? [])
        .filter(
          ({ field, before, after }) => !sameValue(before, after) && !isRenamedName(action, field),
        )
        .map(({ field, before, after }) => changeLine(action, field, before, after))
    : [];
