import { type Diagnostic } from "@backlog-blueprint/core";
import { CrossCircledIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { Callout, Flex, Text } from "@radix-ui/themes";

import { diagnosticView } from "../view";

type DiagnosticListProps = { diagnostics: Diagnostic[]; nothingWritten?: boolean };

const position = ({ line, column }: Diagnostic): string =>
  line === undefined ? "" : `${line}:${column ?? 1}`;

export const DiagnosticList = ({ diagnostics, nothingWritten = false }: DiagnosticListProps) => {
  const { summary, blocks } = diagnosticView(diagnostics, { nothingWritten });

  if (blocks.length === 0) {
    return null;
  }

  const hasPositions = blocks.some(({ diagnostic }) => diagnostic.line !== undefined);

  return (
    <Flex direction="column" gap="2">
      {summary === undefined ? null : (
        <Text size="2" weight="bold">
          {summary}
        </Text>
      )}
      {blocks.map(({ diagnostic, text }, index) => (
        <Callout.Root
          color={diagnostic.severity === "error" ? "red" : "amber"}
          key={`${diagnostic.id}:${diagnostic.path}:${index}`}
          size="1"
          variant="surface"
        >
          <Callout.Icon>
            {diagnostic.severity === "error" ? <CrossCircledIcon /> : <ExclamationTriangleIcon />}
          </Callout.Icon>
          {/*
           * `div` や `pre` で包まない。`Callout.Text` が出すのは `<p>` で `asChild` も受けないので、
           * `<p>` 自身を横並びの器にして中は `span` で済ませる。字下げは `.mono` の `white-space` が残す。
           */}
          <Callout.Text className="diagnostic-line">
            {hasPositions ? (
              <span className="diagnostic-position">{position(diagnostic)}</span>
            ) : null}
            <span className="mono">{text}</span>
          </Callout.Text>
        </Callout.Root>
      ))}
    </Flex>
  );
};
