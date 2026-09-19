import {
  renderApplyResult,
  renderHttpFailure,
  type ResolutionTable,
} from "@backlog-blueprint/core";

import { CopyButton } from "../components/copy-button";
import { projectUrl } from "../plan";
import { type ApplyProgress } from "../progress";

export type ApplyRun = {
  progress: ApplyProgress;
  running: boolean;
  resolutions?: ResolutionTable;
  projectKey: string;
  space: string;
  failure?: unknown;
};

export type ApplyStepProps = { run: ApplyRun };

const resultText = ({ progress, resolutions }: ApplyRun): string => {
  const { outcome } = progress;

  return outcome === undefined ? "" : renderApplyResult(outcome, { color: false, resolutions });
};

export const ApplyStep = ({ run }: ApplyStepProps) => {
  const { progress, running, failure } = run;
  const text = resultText(run);
  const succeeded = progress.outcome?.result === "succeeded";
  const aborted = progress.outcome?.result === "aborted";

  return (
    <div className="step-body">
      <div className="progress">
        <progress max={progress.total} value={progress.completed} />
        <span className="progress-counter">
          {progress.completed} / {progress.total}
        </span>
      </div>
      {progress.lines.length === 0 ? null : (
        <pre className="progress-lines">{progress.lines.join("\n")}</pre>
      )}
      {text === "" ? null : <pre className="apply-result">{text}</pre>}
      {succeeded ? (
        <p>
          <a href={projectUrl(run.space, run.projectKey)} rel="noreferrer" target="_blank">
            Open {run.projectKey} in Backlog
          </a>
        </p>
      ) : null}
      {aborted ? (
        <div className="actions">
          <CopyButton label="Copy report" text={() => text} />
        </div>
      ) : null}
      {failure === undefined ? null : (
        <pre className="failure">{renderHttpFailure(failure, { color: false })}</pre>
      )}
      {running ? <p className="panel-hint">Applying. Do not close this tab.</p> : null}
    </div>
  );
};
