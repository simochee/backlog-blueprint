import { lazy, Suspense, useState, type DragEvent } from "react";

import { type ExportNotes } from "../manifest-document";
import { projectUrl } from "../plan";
import { type EditorJump, type EditorPosition } from "../editor-position";

/** 最初の読み込みに載せない。エディタは接続まで現れず、接続前の画面が待つ理由が無い */
const ManifestEditor = lazy(async () => {
  const loaded = await import("./manifest-editor");

  return { default: loaded.ManifestEditor };
});

export type FileFailure = { action: "open" | "save"; message: string };

type ManifestPaneProps = {
  text: string;
  onTextChange: (text: string) => void;
  onFileDropped: (name: string, text: string) => void;
  documentName: string;
  untitled: boolean;
  unsaved: boolean;
  notes?: ExportNotes;
  onDismissNotes: () => void;
  fileFailure?: FileFailure;
  onDismissFailure: () => void;
  space: string;
  author: string;
  onOpen: () => void;
  onImport: () => void;
  onCursorChange: (position: EditorPosition) => void;
  jump?: EditorJump;
};

const carriesFiles = (event: DragEvent): boolean => event.dataTransfer.types.includes("Files");

const readDroppedFile = async (
  event: DragEvent,
  onFileDropped: (name: string, text: string) => void,
): Promise<void> => {
  const [file] = event.dataTransfer.files;

  if (file !== undefined) {
    onFileDropped(file.name, await file.text());
  }
};

const Welcome = ({
  space,
  author,
  onOpen,
  onImport,
}: Pick<ManifestPaneProps, "space" | "author" | "onOpen" | "onImport">) => (
  <div className="welcome">
    <div className="welcome-inner">
      <div className="title-block">
        <dl>
          {[
            ["PROJECT", "UNTITLED"],
            ["SPACE", space],
            ["AUTHOR", `@${author}`],
            ["SCALE", "1 : 1"],
          ].map(([term, detail]) => (
            <div className="title-block-row" key={term}>
              <dt>{term}</dt>
              <dd>{detail}</dd>
            </div>
          ))}
        </dl>
        <div className="title-block-actions">
          <button onClick={onOpen} type="button">
            Open file
          </button>
          <button onClick={onImport} type="button">
            Import from Backlog
          </button>
        </div>
      </div>
      <p className="note">or paste YAML anywhere, or drop a .yaml file on this sheet</p>
    </div>
  </div>
);

export const ManifestPane = ({
  text,
  onTextChange,
  onFileDropped,
  documentName,
  untitled,
  unsaved,
  notes,
  onDismissNotes,
  fileFailure,
  onDismissFailure,
  space,
  author,
  onOpen,
  onImport,
  onCursorChange,
  jump,
}: ManifestPaneProps) => {
  const [dragging, setDragging] = useState(false);
  const empty = text === "";
  const lines = empty ? 0 : text.split("\n").length;

  return (
    <>
      <div className="editor-tabs">
        <div aria-label="Document" className="editor-tab" role="group">
          <span className="editor-tab-name" data-untitled={untitled}>
            {documentName}
          </span>
          {unsaved ? (
            <span aria-label="Unsaved" className="unsaved-dot" role="img" title="Unsaved changes" />
          ) : (
            <span aria-hidden className="saved-mark">
              ×
            </span>
          )}
        </div>
        <span className="sheet-label">
          {lines === 0 ? "MANIFEST" : `MANIFEST · ${lines} ${lines === 1 ? "LINE" : "LINES"}`}
        </span>
      </div>
      {fileFailure === undefined ? null : (
        <div className="banner" data-tone="destroy" role="alert">
          <span className="chip">
            {fileFailure.action === "open" ? "Cannot open" : "Cannot save"}
          </span>
          <p className="banner-text">{fileFailure.message}</p>
          <button
            aria-label="Dismiss"
            className="close-button"
            onClick={onDismissFailure}
            type="button"
          >
            ×
          </button>
        </div>
      )}
      {notes === undefined ? null : (
        <div className="banner" data-tone="change">
          <span className="chip">Has issues</span>
          <p className="banner-text mono">{notes.text}</p>
          <a href={projectUrl(space, notes.projectKey)} rel="noreferrer" target="_blank">
            Open {notes.projectKey} in Backlog ↗
          </a>
          <button
            aria-label="Dismiss"
            className="close-button"
            onClick={onDismissNotes}
            type="button"
          >
            ×
          </button>
        </div>
      )}
      <div
        className="editor-area"
        data-empty={empty}
        onDragEnter={(event) => {
          if (carriesFiles(event)) {
            setDragging(true);
          }
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void readDroppedFile(event, onFileDropped);
        }}
      >
        <Suspense fallback={<div className="manifest-editor" />}>
          <ManifestEditor
            id="manifest"
            jump={jump}
            onChange={onTextChange}
            onCursorChange={onCursorChange}
            value={text}
          />
        </Suspense>
        {empty && !dragging ? (
          <Welcome author={author} onImport={onImport} onOpen={onOpen} space={space} />
        ) : null}
        {/* 引きずっているあいだはファイル名を出さない。ブラウザが落とすまで名前を渡さない（WU-59）。 */}
        {dragging ? (
          <div className="drop-zone" onDragLeave={() => setDragging(false)}>
            <span className="drop-zone-title">Drop to open</span>
            <span className="drop-zone-note">Replaces {documentName}</span>
          </div>
        ) : null}
      </div>
    </>
  );
};
