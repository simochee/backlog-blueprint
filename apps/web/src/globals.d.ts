/** 実行時に別の出所から版を取らない。スキーマの版は npm の版と同じ番号でなければならない（D-2） */
declare const __SCHEMA_VERSION__: string;

type FilePickerAcceptType = { description?: string; accept: Record<string, string[]> };

/**
 * lib.dom に無いので足す。`undefined` を許すのは、Firefox と Safari には実際に無く、
 * 呼ぶ前に確かめ忘れると型検査が通ったまま落ちるため（WU-44）。
 */
declare var showOpenFilePicker:
  | ((options?: { types?: FilePickerAcceptType[] }) => Promise<FileSystemFileHandle[]>)
  | undefined;

declare var showSaveFilePicker:
  | ((options?: {
      suggestedName?: string;
      types?: FilePickerAcceptType[];
    }) => Promise<FileSystemFileHandle>)
  | undefined;
