import { Card, Flex, Heading, Text } from "@radix-ui/themes";
import { type ReactNode } from "react";

import { StepBoundary } from "./boundary";

export type PanelProps = {
  step: number;
  title: string;
  enabled: boolean;
  hint?: string;
  children: ReactNode;
};

export const Panel = ({ step, title, enabled, hint, children }: PanelProps) => (
  <Card asChild size="3">
    <section aria-disabled={!enabled} className="panel" data-enabled={enabled}>
      <Flex direction="column" gap="4">
        <Flex align="center" asChild gap="3">
          <Heading as="h2" size="4">
            <span className="panel-number">{step}</span>
            {title}
          </Heading>
        </Flex>
        {enabled ? (
          <StepBoundary>{children}</StepBoundary>
        ) : (
          <Text color="gray" size="2">
            {hint}
          </Text>
        )}
      </Flex>
    </section>
  </Card>
);
