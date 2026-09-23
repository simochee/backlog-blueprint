import {
  renderExportNotes,
  renderHttpFailure,
  type Diagnostic,
  type ProjectExport,
} from "@backlog-blueprint/core";
import { DownloadIcon, InfoCircledIcon } from "@radix-ui/react-icons";
import { Button, Callout, Card, Flex, Text, TextField } from "@radix-ui/themes";

import { downloadText } from "../download";
import { CopyButton } from "./copy-button";
import { DiagnosticList } from "./diagnostics";

export type ExportPageProps = {
  projectKey: string;
  onProjectKeyChange: (projectKey: string) => void;
  canExport: boolean;
  exporting: boolean;
  onExport: () => void;
  exported?: ProjectExport;
  diagnostics: Diagnostic[];
  failure?: unknown;
};

const YAML_TYPE = "application/yaml";

const ExportResult = ({ exported }: { exported: ProjectExport }) => {
  const filename = `${exported.projectKey}.yaml`;
  const notes = renderExportNotes(exported);

  return (
    <Flex direction="column" gap="3">
      {notes === "" ? null : (
        <Callout.Root color="blue" size="1" variant="surface">
          <Callout.Icon>
            <InfoCircledIcon />
          </Callout.Icon>
          <pre className="mono">{notes}</pre>
        </Callout.Root>
      )}
      <Flex align="center" gap="3" justify="between" wrap="wrap">
        <Text className="mono" size="2" weight="bold">
          {filename}
        </Text>
        <Flex gap="3">
          <CopyButton label="Copy YAML" text={() => exported.yaml} />
          <Button
            color="gray"
            onClick={() => downloadText(filename, exported.yaml, YAML_TYPE)}
            size="3"
            type="button"
            variant="soft"
          >
            <DownloadIcon />
            Download
          </Button>
        </Flex>
      </Flex>
      <Card size="2" variant="surface">
        <pre aria-label={`Exported manifest ${filename}`} className="mono export-yaml">
          {exported.yaml}
        </pre>
      </Card>
    </Flex>
  );
};

export const ExportPage = ({
  projectKey,
  onProjectKeyChange,
  canExport,
  exporting,
  onExport,
  exported,
  diagnostics,
  failure,
}: ExportPageProps) => (
  <Flex direction="column" gap="4">
    <Flex align="end" gap="3" wrap="wrap">
      <Flex direction="column" flexGrow="1" gap="1">
        <Text as="label" htmlFor="export-project-key" size="2" weight="medium">
          Project key
        </Text>
        <TextField.Root
          id="export-project-key"
          onChange={(event) => onProjectKeyChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && canExport && !exporting) {
              onExport();
            }
          }}
          placeholder="PROJ_A"
          size="3"
          spellCheck={false}
          value={projectKey}
        />
      </Flex>
      <Button disabled={!canExport || exporting} loading={exporting} onClick={onExport} size="3">
        Export
      </Button>
    </Flex>
    <Text color="gray" size="2">
      Reads the project and writes it out as a manifest. Nothing in Backlog is changed.
    </Text>
    <DiagnosticList diagnostics={diagnostics} nothingWritten />
    {failure === undefined ? null : (
      <pre className="mono">{renderHttpFailure(failure, { color: false })}</pre>
    )}
    {exported === undefined ? null : <ExportResult exported={exported} />}
  </Flex>
);
