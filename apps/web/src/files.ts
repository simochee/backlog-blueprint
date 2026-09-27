import { downloadText } from "./download";
import { openedFile, type ManifestDocument, type OpenedDocument } from "./manifest-document";

const YAML_TYPE = "application/yaml";

const MANIFEST_FILES = [{ description: "Manifest", accept: { [YAML_TYPE]: [".yaml", ".yml"] } }];

export const UNTITLED_FILENAME = "manifest.yaml";

/** WU-44 */
const cancelled = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";

const chooseWithInput = async (): Promise<File | undefined> =>
  new Promise((resolve) => {
    const input = document.createElement("input");

    input.type = "file";
    input.accept = ".yaml,.yml";
    input.addEventListener("change", () => resolve(input.files?.[0]));
    input.addEventListener("cancel", () => resolve(undefined));
    input.click();
  });

/** 閉じられたら `undefined`。API が無い環境では書き戻せる保存先を持たずに開く（WU-44） */
export const openManifestFile = async (): Promise<OpenedDocument | undefined> => {
  if (globalThis.showOpenFilePicker === undefined) {
    const file = await chooseWithInput();

    return file === undefined ? undefined : openedFile(file.name, await file.text());
  }

  try {
    const [handle] = await globalThis.showOpenFilePicker({ types: MANIFEST_FILES });

    if (handle === undefined) {
      return undefined;
    }

    const file = await handle.getFile();

    return openedFile(file.name, await file.text(), handle);
  } catch (error) {
    if (cancelled(error)) {
      return undefined;
    }

    throw error;
  }
};

const writeText = async (handle: FileSystemFileHandle, text: string): Promise<void> => {
  const writable = await handle.createWritable();

  /**
   * 失敗したら閉じずに捨てる。Chromium は書き込みを一時ファイルに溜めて close で置き換えるので、
   * close すると途中までの内容で元のファイルを上書きする。
   */
  try {
    await writable.write(text);
  } catch (error) {
    await writable.abort();
    throw error;
  }

  await writable.close();
};

/**
 * 保存できたら、保存した内容を持つ文書を返す。閉じられたら `undefined`。
 * API が無い環境ではダウンロードに落とし、その時点で保存済みとする（WU-44）。
 */
export const saveManifestFile = async (
  document: ManifestDocument,
  text: string,
): Promise<ManifestDocument | undefined> => {
  const name = document.name ?? UNTITLED_FILENAME;

  try {
    const handle =
      document.handle ??
      (await globalThis.showSaveFilePicker?.({ suggestedName: name, types: MANIFEST_FILES }));

    if (handle === undefined) {
      downloadText(name, text, YAML_TYPE);

      return { ...document, name, savedText: text };
    }

    await writeText(handle, text);

    return { ...document, name: handle.name, handle, savedText: text };
  } catch (error) {
    if (cancelled(error)) {
      return undefined;
    }

    throw error;
  }
};
