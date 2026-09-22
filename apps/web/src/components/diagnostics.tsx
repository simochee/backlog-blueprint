import { type Diagnostic } from "@backlog-blueprint/core";
import { CrossCircledIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { Callout, Flex, Text } from "@radix-ui/themes";

import { diagnosticView } from "../view";

export type DiagnosticListProps = {
  diagnostics: Diagnostic[];
  /** export の集計行（CL-9）。書き出さなかったことを言う */
  nothingWritten?: boolean;
};

const position = ({ line, column }: Diagnostic): string =>
  line === undefined ? "" : `${line}:${column ?? 1}`;

export const DiagnosticList = ({ diagnostics, nothingWritten = false }: DiagnosticListProps) => {
  const { summary, blocks } = diagnosticView(diagnostics, { nothingWritten });

  if (blocks.length === 0) {
    return null;
  }

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
          {/**
           * `Callout.Text` が出すのは `<p>` で、`asChild` も受けない。器の `div` も
           * 字下げを残す `pre` もその中には置けないので、`<p>` 自身を横並びの器にして
           * 中は `span` で済ませる。字下げは `.mono` の `white-space` が残す。
           */}
          <Callout.Text className="diagnostic-line">
            <span className="diagnostic-position">{position(diagnostic)}</span>
            <span className="mono">{text}</span>
          </Callout.Text>
        </Callout.Root>
      ))}
    </Flex>
  );
};
