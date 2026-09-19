import {
  actionLine,
  changeLines,
  orderDiagnostics,
  painter,
  renderDiagnostics,
  styleOf,
  type Action,
  type Diagnostic,
  type LineVariant,
  type Style,
} from "@backlog-blueprint/core";

/** ブラウザに TTY は無い。色は CSS で付けるので、描画には色を付けさせない */
export const PLAIN = painter(false);

export type BadgedAction = { symbol: string; style: Style; text: string; changes: string[] };

const SYMBOL_LENGTH = 1;

const SEPARATOR_LENGTH = 1;

/**
 * 記号は core が描いた行から切り出す。記号の一覧を Web 側に写して持つと、core が
 * 記号を変えたときに CLI と Web で違う記号が出る（NFR-6）。
 */
export const badgedAction = (action: Action, variant: LineVariant = "plan"): BadgedAction => {
  const line = actionLine(action, variant, PLAIN);

  return {
    symbol: line.slice(0, SYMBOL_LENGTH),
    style: styleOf(action.op),
    text: line.slice(SYMBOL_LENGTH + SEPARATOR_LENGTH),
    changes: changeLines(action),
  };
};

export type DiagnosticBlock = { diagnostic: Diagnostic; text: string };

export type DiagnosticView = { summary?: string; blocks: DiagnosticBlock[] };

const BLOCK_SEPARATOR = "\n\n";

/**
 * 1件ずつに行番号（DG-5）を添えたいが、`renderDiagnostics` は全件を1つの文字列にして返す。
 * 文面を Web 側で組み直すと CLI と別の文言になる（NFR-6）ので、返った文字列を並び順で
 * 対応付けて切り分ける。並びを決めるのは `orderDiagnostics`（DG-3）で、同じ関数を
 * 通した配列と突き合わせれば対応が取れる。先頭の件数の要約は診断1件に対応しない。
 */
export const diagnosticView = (diagnostics: Diagnostic[]): DiagnosticView => {
  if (diagnostics.length === 0) {
    return { blocks: [] };
  }

  const ordered = orderDiagnostics(diagnostics);
  const rendered = renderDiagnostics(diagnostics, { paint: PLAIN }).split(BLOCK_SEPARATOR);
  const offset = rendered.length - ordered.length;
  const blocks = ordered.map((diagnostic, index) => ({
    diagnostic,
    text: rendered[offset + index] ?? "",
  }));

  return { ...(offset > 0 ? { summary: rendered[0] } : {}), blocks };
};
