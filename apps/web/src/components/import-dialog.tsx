import { renderHttpFailure, type ProjectExport } from "@backlog-blueprint/core";
import { EnterIcon } from "@radix-ui/react-icons";
import { Button, Dialog, Flex, Text, TextField } from "@radix-ui/themes";
import { startTransition, useActionState, useState } from "react";

import { type ExportAttempt } from "../export";
import { SectionBoundary } from "./boundary";
import { DiagnosticList } from "./diagnostics";

export type ImportDialogProps = {
  onImport: (projectKey: string) => Promise<ExportAttempt>;
  onImported: (exported: ProjectExport) => void;
};

/**
 * モーダルでよい（WU-27）。打つのはプロジェクトキー1つで、そのあいだ背面のエディタを触る用が無い。
 * 接続が変われば呼び出し側が key で作り直し、入力も診断も捨てる（WU-32）。
 */
export const ImportDialog = ({ onImport, onImported }: ImportDialogProps) => {
  const [open, setOpen] = useState(false);
  const [projectKey, setProjectKey] = useState("");

  /** 書き出せたら診断は残さない。エディタに読み込み、モーダルを閉じる（WU-30） */
  const [attempt, runImport, importing] = useActionState<ExportAttempt | undefined>(async () => {
    try {
      const imported = await onImport(projectKey);

      if (imported.exported === undefined) {
        return imported;
      }

      setOpen(false);
      onImported(imported.exported);

      return undefined;
    } catch (error) {
      return { diagnostics: [], failure: error };
    }
  }, undefined);

  const canImport = projectKey.trim() !== "" && !importing;

  const requestImport = (): void => {
    if (canImport) {
      startTransition(runImport);
    }
  };

  return (
    <Dialog.Root onOpenChange={setOpen} open={open}>
      <Dialog.Trigger>
        <Button color="gray" type="button" variant="soft">
          <EnterIcon />
          Import from Backlog
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="32rem" size="3">
        <Dialog.Title size="4">Import from Backlog</Dialog.Title>
        <Dialog.Description color="gray" size="2">
          Reads a project and opens it in the editor as a manifest. Nothing in Backlog is changed.
        </Dialog.Description>
        <SectionBoundary>
          <Flex direction="column" gap="3" mt="4">
            <Flex align="end" gap="3">
              <Flex direction="column" flexGrow="1" gap="1">
                <Text as="label" htmlFor="import-project-key" size="2" weight="medium">
                  Project key
                </Text>
                <TextField.Root
                  id="import-project-key"
                  onChange={(event) => setProjectKey(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      requestImport();
                    }
                  }}
                  placeholder="PROJ_A"
                  spellCheck={false}
                  value={projectKey}
                />
              </Flex>
              <Button disabled={!canImport} loading={importing} onClick={requestImport}>
                Import
              </Button>
            </Flex>
            <DiagnosticList diagnostics={attempt?.diagnostics ?? []} nothingWritten />
            {attempt?.failure === undefined ? null : (
              <pre className="mono">{renderHttpFailure(attempt.failure, { color: false })}</pre>
            )}
          </Flex>
        </SectionBoundary>
      </Dialog.Content>
    </Dialog.Root>
  );
};
