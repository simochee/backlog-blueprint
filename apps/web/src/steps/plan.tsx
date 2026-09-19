import {
  renderHttpFailure,
  renderPlanJson,
  renderWarnings,
  summarize,
  type Action,
  type Diagnostic,
} from "@backlog-blueprint/core";

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
    <li className="action">
      <span className="badge" data-style={style}>
        {symbol}
      </span>
      <div className="action-body">
        <pre className="action-line">{text}</pre>
        {changes.map((change) => (
          <pre className="action-change" key={change}>
            {change}
          </pre>
        ))}
      </div>
    </li>
  );
};

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
    return <pre className="failure">{renderHttpFailure(failure, { color: false })}</pre>;
  }

  if (prepared === undefined) {
    return (
      <div className="step-body">
        <DiagnosticList diagnostics={diagnostics} />
      </div>
    );
  }

  const { actions } = prepared.plan;
  const summary = summarize(actions);
  const shown = showUnchanged ? actions : actions.filter(({ op }) => op !== "noop");
  const warnings = renderWarnings(prepared.report.diagnostics, { paint: PLAIN });

  return (
    <div className="step-body">
      {summary.hasChanges ? null : (
        <p className="panel-hint">No changes. The project already matches the manifest.</p>
      )}
      <ul className="action-list">
        {shown.map((action) => (
          <ActionRow action={action} key={action.id} />
        ))}
      </ul>
      <label className="toggle">
        <input
          checked={showUnchanged}
          onChange={(event) => onShowUnchangedChange(event.target.checked)}
          type="checkbox"
        />
        Show unchanged ({summary.noop})
      </label>
      {warnings === "" ? null : <pre className="warnings">{warnings}</pre>}
      <dl className="summary">
        <div className="summary-item">
          <dt>To add</dt>
          <dd>{summary.create}</dd>
        </div>
        <div className="summary-item">
          <dt>To change</dt>
          <dd>{summary.update + summary.reorder}</dd>
        </div>
        <div className="summary-item">
          <dt>To destroy</dt>
          <dd>{summary.delete}</dd>
        </div>
        <div className="summary-item">
          <dt>Unchanged</dt>
          <dd>{summary.noop}</dd>
        </div>
        <div className="summary-item">
          <dt>Write requests</dt>
          <dd>{summary.writeRequests}</dd>
        </div>
        <div className="summary-item">
          <dt>Estimated seconds</dt>
          <dd>{summary.estimatedSeconds}</dd>
        </div>
      </dl>
      <div className="actions">
        <CopyButton label="Copy JSON" text={() => renderPlanJson(prepared.report)} />
        <button
          className="button primary"
          disabled={applying || !summary.hasChanges}
          onClick={onApply}
          type="button"
        >
          Apply
        </button>
      </div>
    </div>
  );
};
