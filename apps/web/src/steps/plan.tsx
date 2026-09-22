import {
  formatDuration,
  NO_CHANGES,
  renderHttpFailure,
  renderPlanJson,
  renderWarnings,
  summarize,
  type Action,
  type Diagnostic,
} from "@backlog-blueprint/core";
import { Box, Button, Card, Flex, Grid, Switch, Text } from "@radix-ui/themes";

import { CopyButton } from "../components/copy-button";
import { DiagnosticList } from "../components/diagnostics";
import { type PreparedPlan } from "../plan";
import { badgedAction, PLAIN } from "../view";

export type PlanStepProps = {
  prepared?: PreparedPlan;
  diagnostics: Diagnostic[];
  failure?: unknown;
  showUnchanged: boolean;
  onShowUnchangedChange: (showUnchanged: boolean) => void;
  applying: boolean;
  onApply: () => void;
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

export const PlanStep = ({
  prepared,
  diagnostics,
  failure,
  showUnchanged,
  onShowUnchangedChange,
  applying,
  onApply,
}: PlanStepProps) => {
  if (failure !== undefined) {
    return <pre className="mono">{renderHttpFailure(failure, { color: false })}</pre>;
  }

  if (prepared === undefined) {
    return <DiagnosticList diagnostics={diagnostics} />;
  }

  const { actions } = prepared.plan;
  const summary = summarize(actions);
  const shown = showUnchanged ? actions : actions.filter(({ op }) => op !== "noop");
  const warnings = renderWarnings(prepared.report.diagnostics, { paint: PLAIN });

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
      {warnings === "" ? null : <pre className="mono">{warnings}</pre>}
      <Grid columns={{ initial: "2", sm: "3", md: "6" }} gap="2">
        <Stat label="To add" value={summary.create} />
        <Stat label="To change" value={summary.update + summary.reorder} />
        <Stat label="To destroy" value={summary.delete} />
        <Stat label="Unchanged" value={summary.noop} />
        <Stat label="Write requests" value={summary.writeRequests} />
        <Stat label="Estimated" value={formatDuration(summary.estimatedSeconds)} />
      </Grid>
      <Flex gap="3" justify="end">
        <CopyButton label="Copy JSON" text={() => renderPlanJson(prepared.report)} />
        <Button
          disabled={applying || !summary.hasChanges}
          loading={applying}
          onClick={onApply}
          size="3"
        >
          Apply
        </Button>
      </Flex>
    </Flex>
  );
};
