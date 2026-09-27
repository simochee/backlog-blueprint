import { autocompletion, type Completion } from "@codemirror/autocomplete";
import { indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { type Diagnostic as LintDiagnostic, setDiagnosticsEffect } from "@codemirror/lint";
import {
  EditorSelection,
  EditorState,
  Prec,
  RangeSet,
  RangeSetBuilder,
  StateField,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  gutterLineClass,
  keymap,
  MatchDecorator,
  placeholder,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

import { type EditorJump, type EditorPosition } from "../editor-position";
import { manifestSchemaExtensions } from "../manifest-schema";

type ManifestEditorProps = {
  id: string;
  value: string;
  onChange: (text: string) => void;
  onCursorChange: (position: EditorPosition) => void;
  jump?: EditorJump;
};

/** トークンにある色を値で写さない。ページ（styles.css）と別に持つと、エディタだけ配色がずれる（WU-51） */
const blueprintTheme = EditorView.theme(
  {
    "&": { height: "100%", backgroundColor: "transparent", color: "var(--ink)", fontSize: "13px" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "20px" },
    ".cm-content": { padding: "10px 0", caretColor: "var(--ink)" },
    ".cm-line": { padding: "0 16px" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--ink)" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground":
      { backgroundColor: "rgba(244, 248, 255, 0.2)" },
    ".cm-activeLine": { backgroundColor: "rgba(244, 248, 255, 0.07)" },
    ".cm-gutters": {
      backgroundColor: "rgba(18, 58, 107, 0.4)",
      borderRight: "1px solid rgba(244, 248, 255, 0.14)",
      color: "var(--ink-dim)",
      fontSize: "11.5px",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      position: "relative",
      minWidth: "40px",
      padding: "0 8px 0 14px",
    },
    ".cm-foldGutter .cm-gutterElement": { padding: "0 4px 0 0", color: "var(--ink-dim)" },
    ".cm-activeLineGutter": { backgroundColor: "rgba(244, 248, 255, 0.07)", color: "var(--ink)" },
    ".cm-lineNumbers .cm-diagnostic-line::before": {
      content: '""',
      position: "absolute",
      top: "7px",
      left: "6px",
      width: "6px",
      height: "6px",
      backgroundColor: "var(--tone)",
    },
    ".cm-diagnostic-line.cm-line-error": { "--tone": "var(--destroy)" },
    ".cm-diagnostic-line.cm-line-warning": { "--tone": "var(--change)" },
    ".cm-placeholder": { color: "rgba(244, 248, 255, 0.5)" },
    // 構文の色の span が内側にあっても外側にあっても勝つように、子孫まで塗る。
    ".cm-scalar, .cm-scalar *": { color: "#9fe6ff" },
    ".cm-env-reference, .cm-env-reference *": {
      color: "var(--variable)",
      textDecoration: "underline dotted rgba(255, 197, 107, 0.7)",
      textUnderlineOffset: "4px",
    },
    ".cm-lintRange-error, .cm-lintRange-warning": {
      backgroundImage: "none",
      textDecorationLine: "underline",
      textDecorationStyle: "wavy",
      textUnderlineOffset: "4px",
      textDecorationSkipInk: "none",
    },
    ".cm-lintRange-error": { textDecorationColor: "#ff8f86" },
    ".cm-lintRange-warning": { textDecorationColor: "var(--change)" },
    ".cm-tooltip": {
      border: "1px solid var(--ink)",
      backgroundColor: "var(--paper-deep)",
      boxShadow: "var(--shadow-pop)",
      color: "var(--ink)",
      fontFamily: "var(--font-mono)",
      fontSize: "12px",
    },
    ".cm-tooltip-hover": { maxWidth: "440px", padding: "10px 12px", lineHeight: "1.5" },
    ".cm-tooltip-lint": { maxWidth: "440px" },
    ".cm-diagnostic": { padding: "10px 12px", borderLeft: "0", lineHeight: "1.5" },
    ".cm-diagnostic-error": { borderLeft: "0" },
    ".cm-diagnostic-warning": { borderLeft: "0" },
    ".cm-tooltip.cm-tooltip-autocomplete": { width: "300px" },
    ".cm-tooltip.cm-tooltip-autocomplete > ul": {
      fontFamily: "var(--font-mono)",
      maxHeight: "16em",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      padding: "5px 10px",
      lineHeight: "1.4",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "var(--ink)",
      color: "var(--paper-dark)",
    },
    ".cm-completionIcon": { display: "none" },
    ".cm-completionDetail": {
      marginLeft: "auto",
      fontSize: "10px",
      fontStyle: "normal",
      opacity: "0.75",
    },
    ".cm-completion-swatch": {
      flex: "none",
      width: "10px",
      height: "10px",
      outline: "1px solid rgba(244, 248, 255, 0.4)",
    },
    ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
      backgroundColor: "rgba(244, 248, 255, 0.15)",
    },
    ".cm-selectionMatch": { backgroundColor: "rgba(244, 248, 255, 0.1)" },
    ".cm-panels": { backgroundColor: "var(--paper-dark)", color: "var(--ink)" },
    ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--line-strong)" },
    ".cm-textfield": {
      border: "1px solid var(--field-line)",
      borderRadius: "0",
      backgroundColor: "var(--paper-deep)",
      color: "var(--ink)",
    },
    ".cm-button": {
      border: "1px solid var(--line-tool)",
      borderRadius: "0",
      backgroundImage: "none",
      backgroundColor: "transparent",
      color: "var(--ink)",
    },
  },
  { dark: true },
);

const blueprintHighlight = HighlightStyle.define([
  { tag: tags.definition(tags.propertyName), color: "var(--ink)" },
  { tag: [tags.string, tags.special(tags.string), tags.content], color: "#ffe2a0" },
  { tag: tags.lineComment, color: "rgba(244, 248, 255, 0.5)" },
  {
    tag: [tags.separator, tags.punctuation, tags.squareBracket, tags.brace],
    color: "rgba(244, 248, 255, 0.55)",
  },
  { tag: [tags.meta, tags.keyword, tags.labelName, tags.typeName], color: "#9fe6ff" },
]);

/** `$${NAME}` を印にしない。core の展開（S2）が文字どおりに残す書き方である（environment.ts） */
const environmentReferences = new MatchDecorator({
  regexp: /(?<!\$)\$\{[^}]+\}/gu,
  decoration: Decoration.mark({ class: "cm-env-reference" }),
});

const environmentMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = environmentReferences.createDeco(view);
    }

    update(update: ViewUpdate) {
      this.decorations = environmentReferences.updateDeco(update, this.decorations);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/**
 * 構文木の型で色を分けない。lang-yaml は引用符の無い値を数でも真偽でも文字列でも同じ `Literal`
 * にするので、`true` や `3` を見分けるには値そのものを見るしかない。
 */
const SCALAR = /^(?:true|false|null|~|[-+]?\d+(?:\.\d+)?)$/u;

const scalarDecoration = Decoration.mark({ class: "cm-scalar" });

const scalarsIn = (view: EditorView): DecorationSet => {
  const builder = new RangeSetBuilder<Decoration>();

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === "Literal" && node.node.parent?.name !== "Key") {
          if (SCALAR.test(view.state.doc.sliceString(node.from, node.to))) {
            builder.add(node.from, node.to, scalarDecoration);
          }
        }
      },
    });
  }

  return builder.finish();
};

const scalarMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = scalarsIn(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = scalarsIn(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

class LineClass extends GutterMarker {
  override readonly elementClass: string;

  constructor(elementClass: string) {
    super();
    this.elementClass = elementClass;
  }

  override eq(other: GutterMarker): boolean {
    return other.elementClass === this.elementClass;
  }
}

const ERROR_LINE = new LineClass("cm-diagnostic-line cm-line-error");

const WARNING_LINE = new LineClass("cm-diagnostic-line cm-line-warning");

const linesOf = (diagnostics: readonly LintDiagnostic[], doc: Text): RangeSet<GutterMarker> => {
  const worst = new Map<number, GutterMarker>();

  for (const { from, severity } of diagnostics) {
    const { from: start } = doc.lineAt(Math.min(from, doc.length));

    if (severity === "error") {
      worst.set(start, ERROR_LINE);
    } else if (severity === "warning" && !worst.has(start)) {
      worst.set(start, WARNING_LINE);
    }
  }

  return RangeSet.of(
    [...worst].sort(([a], [b]) => a - b).map(([start, marker]) => marker.range(start)),
  );
};

/**
 * 印を lint の状態から読み直さない。lint の StateField は公開されておらず、`tr.state` を
 * フィールドの更新の中で読むと計算が循環する。lint が送る効果の中身から描く。
 */
const diagnosticLines = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update: (value, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setDiagnosticsEffect)) {
        return linesOf(effect.value, transaction.newDoc);
      }
    }

    return value.map(transaction.changes);
  },
  provide: (field) => gutterLineClass.from(field),
});

const HEX_COLOR = /^"?(#[\da-f]{6})"?$/iu;

const colorSwatch = (completion: Completion): Node | null => {
  const [, color] = HEX_COLOR.exec(completion.label) ?? [];

  if (color === undefined) {
    return null;
  }

  const swatch = document.createElement("span");

  swatch.className = "cm-completion-swatch";
  swatch.style.backgroundColor = color;

  return swatch;
};

const positionOf = (state: EditorState): EditorPosition => {
  const { head } = state.selection.main;
  const line = state.doc.lineAt(head);

  return { line: line.number, column: head - line.from + 1 };
};

export const ManifestEditor = ({
  id,
  value,
  onChange,
  onCursorChange,
  jump,
}: ManifestEditorProps) => {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  // コールバックを直接渡さない。view は一度しか作らないので、生成時の props を閉じ込めると
  // 2回目以降の入力が古いコールバックに届く。描画中に ref を書くのは React の規則に反するので、
  // 差し替えは効果で行う。読むのは DOM の入力のときだけなので commit の後で間に合う。
  const notify = useRef({ onChange, onCursorChange });

  useEffect(() => {
    notify.current = { onChange, onCursorChange };
  });

  useEffect(() => {
    if (host.current === null) {
      return undefined;
    }

    const created = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          // 空行を足さない。Mod+Enter は Plan に割り当てた（WU-58）。true を返すとエディタは
          // 既定の動作を止めるが、キーは文書まで届く。
          Prec.highest(keymap.of([{ key: "Mod-Enter", run: () => true }])),
          manifestSchemaExtensions(),
          autocompletion({ addToOptions: [{ render: colorSwatch, position: 20 }] }),
          blueprintTheme,
          syntaxHighlighting(blueprintHighlight),
          environmentMarks,
          scalarMarks,
          diagnosticLines,
          placeholder("Paste a manifest, drop a file here, or use Open or Import from Backlog"),
          // 落としたファイルの中身をカーソルの位置に挿さない。文書ごと差し替える（WU-59）。
          EditorView.domEventHandlers({
            drop: (event) => (event.dataTransfer?.files.length ?? 0) > 0,
          }),
          // 器の div にラベルを付けない。編集領域に結び付かず、読み上げられない。
          EditorView.contentAttributes.of({ "aria-label": "Manifest" }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              notify.current.onChange(update.state.doc.toString());
            }

            if (update.docChanged || update.selectionSet) {
              notify.current.onCursorChange(positionOf(update.state));
            }
          }),
        ],
      }),
    });

    view.current = created;

    return () => {
      created.destroy();
      view.current = null;
    };
    // 生成は一度きり。value の反映は下の効果が受け持つ。
  }, []);

  useEffect(() => {
    const { current } = view;

    // 打っている最中に書き戻さない。同じ内容を差し替えると選択と undo の履歴が飛ぶ。
    if (current !== null && current.state.doc.toString() !== value) {
      current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    const { current } = view;

    if (current === null || jump === undefined) {
      return;
    }

    const { doc } = current.state;
    const line = doc.line(Math.min(Math.max(jump.line, 1), doc.lines));
    const anchor = Math.min(line.from + Math.max(jump.column - 1, 0), line.to);

    current.dispatch({
      selection: EditorSelection.cursor(anchor),
      effects: EditorView.scrollIntoView(anchor, { y: "center" }),
    });
    current.focus();
  }, [jump]);

  return <div className="manifest-editor" id={id} ref={host} />;
};
