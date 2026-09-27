import { type RateLimit } from "@backlog-blueprint/core";

import { entryState, formatTime, type Tone } from "../output";
import { type OutputView } from "./output-panel";

type StatusBarProps = {
  errors: number;
  warnings: number;
  onProblems: () => void;
  latest?: OutputView;
  planning: boolean;
  onOutput: () => void;
  missingValues: number;
  onEnvironment: () => void;
  cursor: { line: number; column: number };
  schemaVersion: string;
  domain: string;
  rateLimit: RateLimit;
};

type Line = { text: string; tone: Tone };

const latestLine = ({ entry, run, outdated }: OutputView): Line => {
  const state = entryState(entry, run, outdated);

  if (run !== undefined) {
    const { completed, total } = run.progress;

    if (state.label === "Applying") {
      return { text: `● Applying ${completed} / ${total}`, tone: state.tone };
    }

    return state.label === "Applied"
      ? { text: `✓ Applied ${formatTime(run.startedAt)}`, tone: state.tone }
      : { text: `✕ Apply aborted ${Math.min(completed + 1, total)} / ${total}`, tone: state.tone };
  }

  if (entry.attempt.prepared === undefined) {
    return { text: `✕ Plan stopped ${formatTime(entry.startedAt)}`, tone: state.tone };
  }

  return outdated
    ? { text: "● Plan outdated", tone: state.tone }
    : { text: `● Planned ${formatTime(entry.startedAt)}`, tone: state.tone };
};

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

export const StatusBar = ({
  errors,
  warnings,
  onProblems,
  latest,
  planning,
  onOutput,
  missingValues,
  onEnvironment,
  cursor,
  schemaVersion,
  domain,
  rateLimit,
}: StatusBarProps) => {
  const line = latest === undefined ? undefined : latestLine(latest);

  return (
    <footer aria-label="Status" className="status-bar">
      <button
        aria-label={`${plural(errors, "error")}, ${plural(warnings, "warning")}. Open Problems`}
        className="status-item status-counts"
        onClick={onProblems}
        title="Open Problems"
        type="button"
      >
        <span className="count" data-kind="errors" data-tone={errors === 0 ? "weak" : "destroy"}>
          {errors}
        </span>
        <span className="count" data-tone={warnings === 0 ? "weak" : "change"}>
          ▲ {warnings}
        </span>
      </button>
      {planning ? (
        <button className="status-item" onClick={onOutput} type="button">
          <span aria-hidden className="spinner" />
          Reading the space...
        </button>
      ) : null}
      {!planning && line !== undefined ? (
        <button
          className="status-item"
          data-tone={line.tone}
          onClick={onOutput}
          title="Open Output"
          type="button"
        >
          {line.text}
        </button>
      ) : null}
      {missingValues === 0 ? null : (
        <button
          className="status-item"
          data-tone="change"
          onClick={onEnvironment}
          title="Open Environment values"
          type="button"
        >
          $ {plural(missingValues, "value")} missing
        </button>
      )}
      <span className="status-spacer" />
      <div className="status-bar-right">
        <span className="status-item">
          Ln {cursor.line}, Col {cursor.column}
        </span>
        <span className="status-item">YAML · schema {schemaVersion}</span>
        <span className="status-item">{domain}</span>
        <span className="status-item" title="Update rate limit">
          UPDATES{" "}
          <span className="status-value">
            {rateLimit.remaining} / {rateLimit.limit}
          </span>
        </span>
      </div>
    </footer>
  );
};
