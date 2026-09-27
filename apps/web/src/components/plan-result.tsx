import {
  formatDuration,
  NO_CHANGES,
  renderHttpFailure,
  renderPlanJson,
  summarize,
  type Action,
  type Diagnostic,
  type Style,
} from "@backlog-blueprint/core";

import { type Tone } from "../output";
import { type PreparedPlan } from "../plan";
import { badgedAction } from "../view";
import { CopyButton } from "./copy-button";
import { DiagnosticList, WarningList } from "./diagnostics";

const TONES: Partial<Record<Style, Tone>> = {
  create: "add",
  update: "change",
  delete: "destroy",
  refresh: "refresh",
  noop: "weak",
};

const ActionRow = ({ action }: { action: Action }) => {
  const { symbol, style, label, detail, changes } = badgedAction(action);

  return (
    <div className="action">
      <div className="action-line" data-tone={TONES[style] ?? "weak"}>
        <span className="action-symbol">{symbol}</span>
        <span className="action-label">{label}</span>
        <span className="mono">{detail}</span>
      </div>
      {changes.map((change) => (
        <div className="action-change" key={change}>
          {change}
        </div>
      ))}
    </div>
  );
};

type PlanResultProps = {
  prepared?: PreparedPlan;
  diagnostics: Diagnostic[];
  failure?: unknown;
  showUnchanged: boolean;
};

export const PlanResult = ({ prepared, diagnostics, failure, showUnchanged }: PlanResultProps) => {
  if (failure !== undefined) {
    return <p className="failure mono">{renderHttpFailure(failure, { color: false })}</p>;
  }

  if (prepared === undefined) {
    return <DiagnosticList diagnostics={diagnostics} />;
  }

  const { actions } = prepared.plan;
  const shown = showUnchanged ? actions : actions.filter(({ op }) => op !== "noop");

  return (
    <>
      {summarize(actions).hasChanges ? null : <p className="plan-note">{NO_CHANGES}</p>}
      <div aria-label="Actions" role="group">
        {shown.map((action) => (
          <ActionRow action={action} key={action.id} />
        ))}
      </div>
      <WarningList diagnostics={prepared.report.diagnostics} />
    </>
  );
};

type SummaryRow = { label: string; value: string | number; tone?: Tone };

export const PlanSummary = ({ prepared }: { prepared: PreparedPlan }) => {
  const summary = summarize(prepared.plan.actions);
  const rows: SummaryRow[] = [
    { label: "To add", value: summary.create, tone: "add" },
    { label: "To change", value: summary.update + summary.reorder, tone: "change" },
    { label: "To destroy", value: summary.delete, tone: "destroy" },
    { label: "Unchanged", value: summary.noop },
    { label: "Write requests", value: summary.writeRequests },
    { label: "Estimated", value: formatDuration(summary.estimatedSeconds) },
  ];

  return (
    <section aria-label="Summary" className="summary">
      <div className="summary-heading">SUMMARY</div>
      <dl>
        {rows.map(({ label, value, tone }) => (
          <div className="summary-row" data-tone={tone} key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="summary-footer">
        <CopyButton label="Copy JSON" text={() => renderPlanJson(prepared.report)} />
      </div>
    </section>
  );
};
