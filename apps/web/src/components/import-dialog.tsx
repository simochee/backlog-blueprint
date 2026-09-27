import { renderHttpFailure, type ProjectExport } from "@backlog-blueprint/core";
import { Dialog } from "radix-ui";
import { startTransition, useActionState, useState } from "react";

import { type ExportAttempt } from "../export";
import { SectionBoundary } from "./boundary";
import { DiagnosticList } from "./diagnostics";

type ImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (projectKey: string) => Promise<ExportAttempt>;
  onImported: (exported: ProjectExport) => void;
};

const BUSY = "Import is running";

export const ImportDialog = ({ open, onOpenChange, onImport, onImported }: ImportDialogProps) => {
  const [projectKey, setProjectKey] = useState("");

  const [attempt, runImport, importing] = useActionState<ExportAttempt | undefined>(async () => {
    try {
      const imported = await onImport(projectKey);

      if (imported.exported === undefined) {
        return imported;
      }

      onOpenChange(false);
      onImported(imported.exported);

      return undefined;
    } catch (error) {
      return { diagnostics: [], failure: error };
    }
  }, undefined);

  const canImport = projectKey.trim() !== "" && !importing;
  const failed = attempt !== undefined && !importing;

  const requestImport = (): void => {
    if (canImport) {
      startTransition(runImport);
    }
  };

  return (
    <Dialog.Root
      onOpenChange={(next) => {
        // 書き出している最中は閉じさせない（WU-30）。この Action は押した時点の `onImported` を
        // 掴んだまま解決するので、閉じた後に打った書きかけも切り替えた後の接続も知らずに置き換える。
        if (!importing) {
          onOpenChange(next);
        }
      }}
      open={open}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content className="modal">
          <div className="modal-header">
            <Dialog.Title className="modal-title">Import from Backlog</Dialog.Title>
            <Dialog.Close asChild>
              <button
                aria-label="Close"
                className="close-button"
                disabled={importing}
                title={importing ? BUSY : "Close"}
                type="button"
              >
                ×
              </button>
            </Dialog.Close>
          </div>
          <SectionBoundary>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                requestImport();
              }}
            >
              <div className="modal-body">
                <Dialog.Description className="modal-description">
                  Reads a project into the editor as a manifest. Nothing is written to Backlog.
                </Dialog.Description>
                <div className="field">
                  <label className="field-label" htmlFor="import-project-key">
                    Project key
                  </label>
                  <input
                    aria-invalid={failed}
                    className="input"
                    disabled={importing}
                    id="import-project-key"
                    onChange={(event) => setProjectKey(event.target.value)}
                    placeholder="PROJ_A"
                    spellCheck={false}
                    value={projectKey}
                  />
                </div>
                {importing ? (
                  <p className="busy-line" role="status">
                    <span aria-hidden className="spinner" />
                    Reading {projectKey.trim()} — statuses, issue types, categories...
                  </p>
                ) : null}
                {failed ? (
                  <>
                    <DiagnosticList diagnostics={attempt.diagnostics} nothingWritten />
                    {attempt.failure === undefined ? null : (
                      <p className="failure mono">
                        {renderHttpFailure(attempt.failure, { color: false })}
                      </p>
                    )}
                  </>
                ) : null}
              </div>
              <div className="modal-footer">
                <Dialog.Close asChild>
                  <button
                    className="button"
                    data-size="modal"
                    disabled={importing}
                    title={importing ? BUSY : undefined}
                    type="button"
                  >
                    Cancel
                  </button>
                </Dialog.Close>
                <button
                  className="button"
                  data-size="modal"
                  data-variant="primary"
                  disabled={!canImport}
                  type="submit"
                >
                  {importing ? "Importing..." : "Import"}
                </button>
              </div>
            </form>
          </SectionBoundary>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
