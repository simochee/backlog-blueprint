import { type Op } from "../resource";

export type Style =
  | "create"
  | "update"
  | "delete"
  | "noop"
  | "refresh"
  | "warning"
  | "error"
  | "note";

/**
 * TTY かどうかも `NO_COLOR` も見ない。`process` を読めない（NFR-5）以上、
 * 色を出すかどうかは呼び出し側が決めて引数で渡す（plan の出力仕様 §1.2）。
 */
export type Paint = (style: Style, text: string) => string;

const CODES: Record<Style, string> = {
  create: "32",
  update: "33",
  delete: "31",
  noop: "90",
  refresh: "36",
  warning: "33",
  error: "31",
  note: "36",
};

/** `"["` と書かない。oxfmt が生の制御文字に畳んでソースに埋め込む（実測） */
const ESCAPE = `${String.fromCharCode(27)}[`;

export const plain: Paint = (_style, text) => text;

export const colored: Paint = (style, text) => `${ESCAPE}${CODES[style]}m${text}${ESCAPE}0m`;

export const painter = (color: boolean): Paint => (color ? colored : plain);

export const styleOf = (op: Op): Style => (op === "reorder" ? "update" : op);
