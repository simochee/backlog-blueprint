import { type ReactNode } from "react";

import { type EntryState } from "../output";

export type PanelTab = "problems" | "output";

type PanelProps = {
  open: boolean;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  onToggle: () => void;
  errors: number;
  warnings: number;
  outputState?: EntryState;
  children: ReactNode;
};

const TAB_IDS: Record<PanelTab, string> = { problems: "panel-problems", output: "panel-output" };

const StateChip = ({ state }: { state: EntryState }) => (
  <span className="chip" data-filled={state.filled} data-tone={state.tone}>
    {state.chip}
  </span>
);

/**
 * 畳んでも状態を消さない。Apply が押せない理由（Outdated）と止まった理由の在りかを、
 * パネルを開かずに読めるようにする（WU-53）。
 */
export const Panel = ({
  open,
  tab,
  onTab,
  onToggle,
  errors,
  warnings,
  outputState,
  children,
}: PanelProps) => (
  <section aria-label="Panel" className="panel" data-open={open}>
    <div className="panel-tabs" role="tablist">
      <button
        aria-controls={open && tab === "problems" ? TAB_IDS.problems : undefined}
        aria-selected={open && tab === "problems"}
        className="panel-tab"
        onClick={() => onTab("problems")}
        role="tab"
        type="button"
      >
        <span className="zone">01</span>
        <span className="panel-tab-label">Problems</span>
        {errors === 0 ? null : (
          <span className="count" data-kind="errors" data-tone="destroy">
            {errors}
          </span>
        )}
        {warnings === 0 ? null : (
          <span className="count" data-tone="change">
            ▲ {warnings}
          </span>
        )}
      </button>
      <button
        aria-controls={open && tab === "output" ? TAB_IDS.output : undefined}
        aria-selected={open && tab === "output"}
        className="panel-tab"
        onClick={() => onTab("output")}
        role="tab"
        type="button"
      >
        <span className="zone">02</span>
        <span className="panel-tab-label">Output</span>
        {outputState === undefined ? null : <StateChip state={outputState} />}
      </button>
      <span className="panel-spacer" />
      <button
        aria-expanded={open}
        aria-label={open ? "Collapse panel" : "Expand panel"}
        className="panel-toggle"
        onClick={onToggle}
        title={open ? "Collapse panel" : "Expand panel"}
        type="button"
      >
        {open ? "▾" : "▴"}
      </button>
    </div>
    {open ? (
      <div className="panel-body" id={TAB_IDS[tab]} role="tabpanel">
        {children}
      </div>
    ) : null}
  </section>
);
