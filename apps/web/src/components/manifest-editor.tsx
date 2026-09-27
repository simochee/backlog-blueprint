import { Compartment, EditorState } from "@codemirror/state";
import { catppuccinLatte, catppuccinMocha } from "@catppuccin/codemirror";
import { indentWithTab } from "@codemirror/commands";
import { keymap, placeholder } from "@codemirror/view";
import { basicSetup, EditorView } from "codemirror";
import { useEffect, useRef, type DragEvent } from "react";

import { useAppearance } from "../appearance";
import { manifestSchemaExtensions } from "../manifest-schema";

type ManifestEditorProps = {
  id: string;
  value: string;
  onChange: (text: string) => void;
  onFileDropped: (name: string, text: string) => void;
};

const readDroppedFile = async (
  event: DragEvent<HTMLDivElement>,
  onFileDropped: (name: string, text: string) => void,
): Promise<void> => {
  const [file] = event.dataTransfer.files;

  if (file !== undefined) {
    onFileDropped(file.name, await file.text());
  }
};

export const ManifestEditor = ({ id, value, onChange, onFileDropped }: ManifestEditorProps) => {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const theme = useRef(new Compartment());
  // `onChange` を直接渡さない。view は一度しか作らないので、生成時の props を閉じ込めると
  // 2回目以降の入力が古い onChange に届く。描画中に ref を書くのは React の規則に反するので、
  // 差し替えは効果で行う。読むのは DOM の入力のときだけなので commit の後で間に合う。
  const notify = useRef(onChange);

  useEffect(() => {
    notify.current = onChange;
  });

  const appearance = useAppearance();
  const startedDark = useRef(appearance === "dark");

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
          manifestSchemaExtensions(),
          placeholder("Paste a manifest, drop a file here, or use Open or Import from Backlog"),
          theme.current.of(startedDark.current ? catppuccinMocha : catppuccinLatte),
          // 器の div にラベルを付けない。編集領域に結び付かず、読み上げられない。
          EditorView.contentAttributes.of({ "aria-label": "Manifest" }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              notify.current(update.state.doc.toString());
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
    // 生成は一度きり。value と配色の反映は下の効果が受け持つ。
  }, []);

  useEffect(() => {
    view.current?.dispatch({
      effects: theme.current.reconfigure(appearance === "dark" ? catppuccinMocha : catppuccinLatte),
    });
  }, [appearance]);

  useEffect(() => {
    const { current } = view;

    // 打っている最中に書き戻さない。同じ内容を差し替えると選択と undo の履歴が飛ぶ。
    if (current !== null && current.state.doc.toString() !== value) {
      current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: value } });
    }
  }, [value]);

  return (
    <div
      className="manifest-editor"
      id={id}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void readDroppedFile(event, onFileDropped);
      }}
      ref={host}
    />
  );
};
