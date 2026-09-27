import { renderExportNotes, type ProjectExport } from "@backlog-blueprint/core";

/** WU-43。エディタが今開いているもの。中身そのものは持たず、比べる相手だけを持つ。 */
export type ManifestDocument = {
  name?: string;
  /** 書き戻せる保存先。File System Access API で開いたか、一度保存したときだけある（WU-44） */
  handle?: FileSystemFileHandle;
  /** 最後に開いた、または保存した内容 */
  savedText: string;
  /** 読み込んだ元が添えた案内（WU-30）。別の文書を開けば文書ごと入れ替わって消える */
  notes?: string;
};

export type OpenedDocument = { document: ManifestDocument; text: string };

export const UNTITLED: ManifestDocument = { savedText: "" };

export const documentName = (document: ManifestDocument): string => document.name ?? "Untitled";

/**
 * 打鍵で立てる印にしない。元に戻したときも保存した直後も、倒し忘れればその経路だけ
 * 印が残る。比べれば今の内容の派生になり、倒す処理そのものが無くなる（WU-4）。
 */
export const hasUnsavedChanges = (document: ManifestDocument, text: string): boolean =>
  text !== document.savedText;

export const openedFile = (
  name: string,
  text: string,
  handle?: FileSystemFileHandle,
): OpenedDocument => ({
  document: { name, handle, savedText: text },
  text,
});

/** Backlog から読んだだけで手元には無いので、保存先も保存した内容も持たない（WU-30 / WU-43） */
export const importedDocument = (exported: ProjectExport): OpenedDocument => {
  const notes = renderExportNotes(exported);

  return {
    document: {
      name: `${exported.projectKey}.yaml`,
      savedText: "",
      notes: notes === "" ? undefined : notes,
    },
    text: exported.yaml,
  };
};
