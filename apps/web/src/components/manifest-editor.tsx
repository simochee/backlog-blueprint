import { Compartment, EditorState } from "@codemirror/state";
import { catppuccinLatte, catppuccinMocha } from "@catppuccin/codemirror";
import { basicSetup, EditorView } from "codemirror";
import { useEffect, useRef, type DragEvent } from "react";

import { useAppearance } from "../appearance";
import { manifestSchemaExtensions } from "../manifest-schema";

export type ManifestEditorProps = {
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
  /**
   * 変更ハンドラを ref 越しに呼ぶ。view は一度しか作らないので、生成時の props を
   * 閉じ込めると、2回目以降の入力が古い onChange に届く。
   *
   * 書き込みを効果に置くのは、描画中に ref を書くのが React の規則に反するため。
   * 読むのは CodeMirror が DOM の入力で呼ぶときだけなので、commit の後に差し替われば間に合う。
   */
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
          manifestSchemaExtensions(),
          theme.current.of(startedDark.current ? catppuccinMocha : catppuccinLatte),
          /** ラベルは器の div に結び付かないので、編集領域そのものに持たせる。 */
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

    /**
     * 打っている最中に書き戻さない。同じ内容を差し替えると選択と undo の履歴が飛ぶので、
     * 外から差し替わったとき（ファイルを落としたとき）だけ反映する。
     */
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
