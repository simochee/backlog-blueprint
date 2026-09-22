import { type Diagnostic } from "@backlog-blueprint/core";
import { Callout, Flex, Text } from "@radix-ui/themes";

import { diagnosticView } from "../view";

export type DiagnosticListProps = { diagnostics: Diagnostic[] };

const position = ({ line, column }: Diagnostic): string =>
  line === undefined ? "" : `${line}:${column ?? 1}`;

export const DiagnosticList = ({ diagnostics }: DiagnosticListProps) => {
  const { summary, blocks } = diagnosticView(diagnostics);

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
          <Callout.Text>
            <Flex align="start" gap="2">
              <span className="diagnostic-position">{position(diagnostic)}</span>
              <pre className="mono">{text}</pre>
            </Flex>
          </Callout.Text>
        </Callout.Root>
      ))}
    </Flex>
  );
};
