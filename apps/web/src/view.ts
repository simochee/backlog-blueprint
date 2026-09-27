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

export const PLAIN = painter(false);

type BadgedAction = {
  symbol: string;
  style: Style;
  text: string;
  label: string;
  detail: string;
  changes: string[];
};

const SYMBOL_LENGTH = 1;

const SEPARATOR_LENGTH = 1;

/** 決まった桁数で切らない。桁は core の持ち物で、長い種類名は桁を越えて空白1つで続く */
const LABEL_COLUMN = /^(\S+)\s*/u;

/**
 * 記号は core が描いた行から切り出す。記号の一覧を Web 側に写して持つと、core が
 * 記号を変えたときに CLI と Web で違う記号が出る（NFR-6）。
 */
export const badgedAction = (action: Action, variant: LineVariant = "plan"): BadgedAction => {
  const line = actionLine(action, variant, PLAIN);
  const text = line.slice(SYMBOL_LENGTH + SEPARATOR_LENGTH);
  const [column = "", label = ""] = LABEL_COLUMN.exec(text) ?? [];

  return {
    symbol: line.slice(0, SYMBOL_LENGTH),
    style: styleOf(action.op),
    text,
    label,
    detail: text.slice(column.length),
    changes: changeLines(action),
  };
};

type DiagnosticBlock = { diagnostic: Diagnostic; text: string; message: string };

type DiagnosticView = { summary?: string; blocks: DiagnosticBlock[] };

const BLOCK_SEPARATOR = "\n\n";

/**
 * 本文を診断の欄から組み直さない（NFR-6）。ID は画面で別の列に出すので、core が先頭に書いた
 * `ERROR [V-A6] ` だけを外す。形が変わって外せなければ、core の文面をそのまま出す。
 */
const messageOf = ({ severity, id }: Diagnostic, text: string): string => {
  const head = `${severity.toUpperCase()} [${id}] `;

  return text.startsWith(head) ? text.slice(head.length) : text;
};

/**
 * 文面を Web 側で組み直さない。CLI と別の文言になる（NFR-6）。`renderDiagnostics` が全件を
 * 1つにした文字列を、同じ `orderDiagnostics`（DG-3）を通した配列と並び順で突き合わせて切り分ける。
 */
export const diagnosticView = (
  diagnostics: Diagnostic[],
  { nothingWritten = false }: { nothingWritten?: boolean } = {},
): DiagnosticView => {
  if (diagnostics.length === 0) {
    return { blocks: [] };
  }

  const ordered = orderDiagnostics(diagnostics);
  const rendered = renderDiagnostics(diagnostics, { paint: PLAIN, nothingWritten }).split(
    BLOCK_SEPARATOR,
  );
  const offset = rendered.length - ordered.length;
  const blocks = ordered.map((diagnostic, index) => {
    const text = rendered[offset + index] ?? "";

    return { diagnostic, text, message: messageOf(diagnostic, text) };
  });

  return { ...(offset > 0 ? { summary: rendered[0] } : {}), blocks };
};
