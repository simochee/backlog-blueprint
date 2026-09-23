import {
  formatDuration,
  NO_CHANGES,
  renderHttpFailure,
  renderPlanJson,
  summarize,
  type Action,
  type Diagnostic,
} from "@backlog-blueprint/core";
import { Box, Card, Flex, Grid, Switch, Text } from "@radix-ui/themes";

import { type PreparedPlan } from "../plan";
import { badgedAction } from "../view";
import { CopyButton } from "./copy-button";
import { DiagnosticList } from "./diagnostics";

export type PlanResultProps = {
  prepared?: PreparedPlan;
  diagnostics: Diagnostic[];
  failure?: unknown;
  showUnchanged: boolean;
  onShowUnchangedChange: (showUnchanged: boolean) => void;
};

const ActionRow = ({ action }: { action: Action }) => {
  const { symbol, style, text, changes } = badgedAction(action);

  return (
    <Flex align="start" className="action-row" gap="2" py="1">
      <span className="action-symbol" data-style={style}>
        {symbol}
      </span>
      <Box>
        <pre className="mono">{text}</pre>
        {changes.map((change) => (
          <pre className="mono" key={change}>
            {change}
          </pre>
        ))}
      </Box>
    </Flex>
  );
};

const Stat = ({ label, value }: { label: string; value: string | number }) => (
  <Card size="1" variant="surface">
    <Text as="div" color="gray" size="1">
      {label}
    </Text>
    <Text as="div" size="5" weight="bold">
      {value}
    </Text>
  </Card>
);

export const PlanResult = ({
  prepared,
  diagnostics,
  failure,
  showUnchanged,
  onShowUnchangedChange,
}: PlanResultProps) => {
  if (failure !== undefined) {
    return <pre className="mono">{renderHttpFailure(failure, { color: false })}</pre>;
  }

  if (prepared === undefined) {
    return <DiagnosticList diagnostics={diagnostics} />;
  }

  const { actions } = prepared.plan;
  const summary = summarize(actions);
  const shown = showUnchanged ? actions : actions.filter(({ op }) => op !== "noop");
  /**
   * `renderWarnings` は端末向けの整形で、`Warnings:` の見出しと字下げを自分で持つ。
   * 画面では重大度が色で出るので、診断の並べ方は 1 箇所（DiagnosticList）に寄せる。
   */
  const warnings = prepared.report.diagnostics.filter(({ severity }) => severity === "warning");

  return (
    <Flex direction="column" gap="4">
      {summary.hasChanges ? null : (
        <Text color="gray" size="2">
          {NO_CHANGES}
        </Text>
      )}
      <Card size="2" variant="surface">
        <Flex direction="column">
          {shown.map((action) => (
            <ActionRow action={action} key={action.id} />
          ))}
        </Flex>
      </Card>
      <Text as="label" size="2">
        <Flex align="center" gap="2">
          <Switch
            checked={showUnchanged}
            onCheckedChange={(checked) => onShowUnchangedChange(checked)}
          />
          Show unchanged ({summary.noop})
        </Flex>
      </Text>
      <DiagnosticList diagnostics={warnings} />
      <Grid columns={{ initial: "2", sm: "3", md: "6" }} gap="2">
        <Stat label="To add" value={summary.create} />
        <Stat label="To change" value={summary.update + summary.reorder} />
        <Stat label="To destroy" value={summary.delete} />
        <Stat label="Unchanged" value={summary.noop} />
        <Stat label="Write requests" value={summary.writeRequests} />
        <Stat label="Estimated" value={formatDuration(summary.estimatedSeconds)} />
      </Grid>
      <Flex justify="end">
        <CopyButton label="Copy JSON" text={() => renderPlanJson(prepared.report)} />
      </Flex>
    </Flex>
  );
};
