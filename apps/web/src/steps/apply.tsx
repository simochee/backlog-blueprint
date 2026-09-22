import { renderApplyResult, renderHttpFailure } from "@backlog-blueprint/core";
import { ExternalLinkIcon } from "@radix-ui/react-icons";
import { Callout, Card, Flex, Link, Progress, Text } from "@radix-ui/themes";

import { CopyButton } from "../components/copy-button";
import { projectUrl } from "../plan";
import { isRunning, type ApplyProgress, type ApplyRun } from "../progress";

export type ApplyStepProps = { run: ApplyRun };

const resultText = ({ progress, resolutions }: ApplyRun): string => {
  const { outcome } = progress;

  return outcome === undefined ? "" : renderApplyResult(outcome, { color: false, resolutions });
};

const percent = ({ completed, total }: ApplyProgress): number =>
  total === 0 ? 0 : Math.round((completed / total) * 100);

export const ApplyStep = ({ run }: ApplyStepProps) => {
  const { progress, failure } = run;
  const text = resultText(run);
  const succeeded = progress.outcome?.result === "succeeded";
  const aborted = progress.outcome?.result === "aborted";

  return (
    <Flex direction="column" gap="4">
      <Flex align="center" gap="3">
        <Progress
          color={aborted ? "red" : "blue"}
          size="3"
          style={{ flex: 1 }}
          value={percent(progress)}
        />
        <Text size="2" weight="medium">
          {progress.completed} / {progress.total}
        </Text>
      </Flex>
      {progress.lines.length === 0 ? null : (
        <Card size="2" variant="surface">
          <pre className="mono">{progress.lines.join("\n")}</pre>
        </Card>
      )}
      {text === "" ? null : (
        <Card size="2" variant="surface">
          <pre className="mono">{text}</pre>
        </Card>
      )}
      {succeeded ? (
        <Callout.Root color="green" size="1" variant="surface">
          <Callout.Text>
            <Link href={projectUrl(run.space, run.projectKey)} rel="noreferrer" target="_blank">
              Open {run.projectKey} in Backlog <ExternalLinkIcon aria-hidden />
            </Link>
          </Callout.Text>
        </Callout.Root>
      ) : null}
      {aborted ? (
        <Flex justify="end">
          <CopyButton label="Copy report" text={() => text} />
        </Flex>
      ) : null}
      {failure === undefined ? null : (
        <pre className="mono">{renderHttpFailure(failure, { color: false })}</pre>
      )}
      {isRunning(run) ? (
        <Text color="gray" size="2">
          Applying. Do not close this tab.
        </Text>
      ) : null}
    </Flex>
  );
};
