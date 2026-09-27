import { renderExportNotes, type ProjectExport } from "@backlog-blueprint/core";

export type ManifestDocument = {
  name?: string;
  handle?: FileSystemFileHandle;
  savedText: string;
  notes?: string;
};

export type OpenedDocument = { document: ManifestDocument; text: string };

export const UNTITLED: ManifestDocument = { savedText: "" };

export const documentName = (document: ManifestDocument): string => document.name ?? "Untitled";

/** 打鍵で立てる印にしない。打って元に戻したときも保存した直後も、倒し忘れれば印が残る（WU-43）。 */
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
