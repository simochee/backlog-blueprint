import { type ProjectExport } from "@backlog-blueprint/core";
import {
  CrossCircledIcon,
  DownloadIcon,
  FileTextIcon,
  InfoCircledIcon,
} from "@radix-ui/react-icons";
import { Badge, Button, Callout, Flex, Text } from "@radix-ui/themes";
import { lazy, Suspense } from "react";

import { type ExportAttempt } from "../export";
import { type ManifestValidation } from "../validation";
import { DiagnosticList } from "./diagnostics";
import { EnvironmentDialog } from "./environment-dialog";
import { ImportDialog } from "./import-dialog";

/** 最初の読み込みに載せない。エディタは接続まで現れず、接続前の画面が待つ理由が無い */
const ManifestEditor = lazy(async () => {
  const loaded = await import("./manifest-editor");

  return { default: loaded.ManifestEditor };
});

type ManifestPaneProps = {
  text: string;
  onTextChange: (text: string) => void;
  onFileDropped: (name: string, text: string) => void;
  documentName: string;
  unsaved: boolean;
  notes?: string;
  fileFailure?: string;
  onOpen: () => void;
  onSave: () => void;
  importKey: string;
  onImport: (projectKey: string) => Promise<ExportAttempt>;
  onImported: (exported: ProjectExport) => void;
  /**
   * 入力欄の一覧を最新の検証結果から取らない。検証は入力が止まってから走る（§2.2）ので、
   * 途中の状態で欄が消えると、環境変数を打っている最中に focus が外れる。
   */
  names: string[];
  validation?: ManifestValidation;
  canPlan: boolean;
  planning: boolean;
  onPlan: () => void;
  canApply: boolean;
  applying: boolean;
  onApply: () => void;
};

export const ManifestPane = ({
  text,
  onTextChange,
  onFileDropped,
  documentName,
  unsaved,
  notes,
  fileFailure,
  onOpen,
  onSave,
  importKey,
  onImport,
  onImported,
  names,
  validation,
  canPlan,
  planning,
  onPlan,
  canApply,
  applying,
  onApply,
}: ManifestPaneProps) => (
  <>
    <Flex align="center" className="workspace-toolbar" gap="3" justify="between" wrap="wrap">
      <Flex align="center" gap="2" wrap="wrap">
        <Button color="gray" onClick={onOpen} type="button" variant="soft">
          <FileTextIcon />
          Open
        </Button>
        <Button
          aria-keyshortcuts="Meta+S Control+S"
          color="gray"
          onClick={onSave}
          title="Save (Cmd+S / Ctrl+S)"
          type="button"
          variant="soft"
        >
          <DownloadIcon />
          Save
        </Button>
        <ImportDialog key={importKey} onImport={onImport} onImported={onImported} />
        {names.length === 0 ? null : <EnvironmentDialog names={names} />}
      </Flex>
      <Flex align="center" gap="3">
        <Flex align="center" aria-label="Document" gap="2" role="group">
          <Text className="mono" color="gray" size="2">
            {documentName}
          </Text>
          {unsaved ? (
            <Badge color="amber" variant="soft">
              Unsaved
            </Badge>
          ) : null}
        </Flex>
        <Button color="gray" disabled={!canPlan} loading={planning} onClick={onPlan} variant="soft">
          Plan
        </Button>
        <Button disabled={!canApply} loading={applying} onClick={onApply}>
          Apply
        </Button>
      </Flex>
    </Flex>
    {fileFailure === undefined ? null : (
      <Callout.Root color="red" size="1" variant="surface">
        <Callout.Icon>
          <CrossCircledIcon />
        </Callout.Icon>
        <Callout.Text>{fileFailure}</Callout.Text>
      </Callout.Root>
    )}
    {notes === undefined ? null : (
      <Callout.Root color="blue" size="1" variant="surface">
        <Callout.Icon>
          <InfoCircledIcon />
        </Callout.Icon>
        <pre className="mono">{notes}</pre>
      </Callout.Root>
    )}
    <Suspense fallback={<div className="manifest-editor" />}>
      <ManifestEditor
        id="manifest"
        onChange={onTextChange}
        onFileDropped={onFileDropped}
        value={text}
      />
    </Suspense>
    <div className="workspace-diagnostics">
      {validation === undefined ? (
        <Text color="gray" size="2">
          Validating...
        </Text>
      ) : (
        <DiagnosticList diagnostics={validation.diagnostics} />
      )}
    </div>
  </>
);
