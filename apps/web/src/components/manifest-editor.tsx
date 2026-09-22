import { projectSchema, projectSchemaUrl } from "@backlog-blueprint/schema";
/**
 * `monaco-editor` の既定の入口（`editor.main`）は 80 以上の言語と、TypeScript や JSON の
 * 言語サービスまで抱えている。要るのは YAML だけなので、部品を選んで読む。
 *
 * `editor.all` を落とさない。`editor.api` は API だけで、補完もホバーも
 * 「寄与」として `editor.all` の側にいる。これが無いと検証の波線だけが出て、
 * 候補も説明も一切出ないエディタになる（波線はコアがマーカーを描くので出てしまい、
 * 壊れていることに気づきにくい）。
 */
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/editor/editor.all";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution";
import { configureMonacoYaml } from "monaco-yaml";
import YamlWorker from "monaco-yaml/yaml.worker?worker";
import { useEffect, useRef, type DragEvent } from "react";

import { useAppearance } from "../appearance";

const SCHEMA_VERSION = __SCHEMA_VERSION__;

const LANGUAGE = "yaml";

globalThis.MonacoEnvironment = {
  getWorker: (_workerId: string, label: string) =>
    label === LANGUAGE ? new YamlWorker() : new EditorWorker(),
};

/**
 * スキーマを URL から取りに行かせない（`enableSchemaRequest` は既定の false のまま）。
 * 走っているコードと同じ定義をその場で渡すほうが、版がずれない。マニフェストの
 * `# yaml-language-server: $schema=` が指す URL でそのまま登録するので、
 * その行を書いたファイルも通信なしで解決する。
 */
configureMonacoYaml(monaco, {
  completion: true,
  hover: true,
  validate: true,
  schemas: [
    {
      fileMatch: ["*"],
      schema: projectSchema(SCHEMA_VERSION),
      uri: projectSchemaUrl(SCHEMA_VERSION),
    },
  ],
});

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
  const editor = useRef<monaco.editor.IStandaloneCodeEditor>(null);
  /**
   * 変更ハンドラを ref 越しに呼ぶ。editor は一度しか作らないので、生成時の props を
   * 閉じ込めると、2回目以降の入力が古い onChange に届く。
   */
  const notify = useRef(onChange);

  notify.current = onChange;

  const appearance = useAppearance();

  useEffect(() => {
    if (host.current === null) {
      return;
    }

    const created = monaco.editor.create(host.current, {
      ariaLabel: "Manifest",
      automaticLayout: true,
      fontSize: 13,
      language: LANGUAGE,
      minimap: { enabled: false },
      padding: { bottom: 12, top: 12 },
      scrollBeyondLastLine: false,
      tabSize: 2,
      value,
    });

    editor.current = created;

    const subscription = created.onDidChangeModelContent(() => {
      notify.current(created.getValue());
    });

    return () => {
      subscription.dispose();
      created.getModel()?.dispose();
      created.dispose();
      editor.current = null;
    };
    // 生成は一度きり。value の反映は下の効果が受け持つ。
  }, []);

  useEffect(() => {
    monaco.editor.setTheme(appearance === "dark" ? "vs-dark" : "vs");
  }, [appearance]);

  useEffect(() => {
    const { current } = editor;

    /**
     * 打っている最中に書き戻さない。同じ値を `setValue` すると選択と undo の履歴が
     * 飛ぶので、外から差し替わったとき（ファイルを落としたとき）だけ反映する。
     */
    if (current !== null && current.getValue() !== value) {
      current.setValue(value);
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
