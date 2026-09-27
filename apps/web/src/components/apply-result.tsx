import { renderApplyResult, renderHttpFailure, renderProgress } from "@backlog-blueprint/core";

import { type Tone } from "../output";
import { projectUrl } from "../plan";
import { isRunning, type ApplyRun, type ProgressMark } from "../progress";
import { CopyButton } from "./copy-button";

const MARKS: Record<ProgressMark, { mark: string; tone: Tone }> = {
  done: { mark: "✓", tone: "add" },
  failed: { mark: "✕", tone: "destroy" },
  waiting: { mark: "●", tone: "change" },
};

type TickState = "done" | "running" | "failed" | "pending";

const tickState = (run: ApplyRun, index: number): TickState => {
  const { completed, outcome } = run.progress;

  if (index < completed) {
    return "done";
  }

  if (index > completed) {
    return "pending";
  }

  if (isRunning(run)) {
    return "running";
  }

  return outcome?.result === "succeeded" ? "done" : "failed";
};

const resultText = ({ progress, resolutions }: ApplyRun): string => {
  const { outcome } = progress;

  return outcome === undefined ? "" : renderApplyResult(outcome, { color: false, resolutions });
};

export const ApplyResult = ({ run }: { run: ApplyRun }) => {
  const { progress, failure } = run;
  const running = isRunning(run);
  const text = resultText(run);
  const succeeded = progress.outcome?.result === "succeeded";
  const stopped = !running && !succeeded;
  const ticks = Array.from({ length: progress.total }, (_, index) => tickState(run, index));
  // `started` は次の Action が始まるまで前の Action を指したまま残るので、済んだかを件数で見る。
  const current =
    running && progress.started !== undefined && progress.started.index >= progress.completed
      ? progress.started
      : undefined;

  return (
    <>
      <div className="progress">
        <div
          aria-hidden
          className="progress-ticks"
          style={{ gridTemplateColumns: `repeat(${Math.max(progress.total, 1)}, 1fr)` }}
        >
          {ticks.map((state, index) => (
            <span className="progress-tick" data-state={state} key={index} />
          ))}
        </div>
        <span className="progress-count">
          {progress.completed} / {progress.total}
        </span>
      </div>
      <div aria-label="Apply log" className="apply-log" role="log">
        {progress.lines.map(({ text: line, mark }, index) => (
          <div className="log-line" data-tone={MARKS[mark].tone} key={index}>
            <span className="log-mark">{MARKS[mark].mark}</span>
            <span className="mono">{line}</span>
          </div>
        ))}
        {current === undefined ? null : (
          <div className="log-line" data-tone="refresh">
            <span className="log-mark">●</span>
            <span className="mono">{renderProgress(current, { color: false })}</span>
          </div>
        )}
      </div>
      {succeeded ? (
        <div className="result-box" data-tone="add">
          <span className="result-box-mark">✓</span>
          <p className="mono">{text}</p>
          <a
            className="link-button"
            href={projectUrl(run.space, run.projectKey)}
            rel="noreferrer"
            target="_blank"
          >
            Open {run.projectKey} in Backlog ↗
          </a>
        </div>
      ) : null}
      {stopped ? (
        <div className="result-box" data-tone="destroy">
          <div className="result-box-head">
            <span className="result-box-title">
              APPLY ABORTED AT {Math.min(progress.completed + 1, progress.total)} / {progress.total}
            </span>
            {text === "" ? null : <CopyButton label="Copy report" text={() => text} />}
          </div>
          {text === "" ? null : <p className="mono">{text}</p>}
          {failure === undefined ? null : (
            <p className="mono">{renderHttpFailure(failure, { color: false })}</p>
          )}
        </div>
      ) : null}
    </>
  );
};
