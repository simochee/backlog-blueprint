import { summarize } from "@backlog-blueprint/core";
import { Checkbox, DropdownMenu } from "radix-ui";
import { type Ref, useEffect, useRef, useState } from "react";

import {
  type ApplyRuns,
  entryLabel,
  entryState,
  formatTime,
  isOutdated,
  type OutputEntry,
  type Section,
  sectionAt,
} from "../output";
import { isRunning, type ApplyRun } from "../progress";
import { ApplyResult } from "./apply-result";
import { SectionBoundary } from "./boundary";
import { PlanResult, PlanSummary } from "./plan-result";

export type OutputView = {
  entry: OutputEntry;
  outdated: boolean;
  run?: ApplyRun;
};

type OutputPanelProps = {
  entries: OutputEntry[];
  runs: ApplyRuns;
  planKey: string;
  view?: OutputView;
  applyRequested?: number;
  onApplyFollowed: () => void;
  preparing: boolean;
  onSelect: (id: number) => void;
  showUnchanged: boolean;
  onShowUnchangedChange: (showUnchanged: boolean) => void;
  onPlanAgain: () => void;
};

/**
 * 表示のまま Plan / Apply と読ませない。タイトルバーの Plan / Apply と同じ名前のボタンが
 * 2つずつ並び、押して何が起きるかが名前から区別できない。
 */
const SECTIONS: { section: Section; title: string; label: string }[] = [
  { section: "plan", title: "Plan", label: "Jump to plan" },
  { section: "apply", title: "Apply", label: "Jump to apply" },
];

/** `.output-body` の padding と揃える */
const SECTION_MARGIN = 12;

/** `<hr>` を使わない。線だけで名前を持てず、「ここから先が適用」を言えない */
const ApplyDivider = ({ ref, startedAt }: { ref: Ref<HTMLDivElement>; startedAt: number }) => (
  <div aria-label="Apply" className="apply-divider" ref={ref} role="separator">
    <span className="apply-divider-tick" />
    <span className="apply-divider-line" />
    <strong>APPLY · {formatTime(startedAt)}</strong>
    <span className="apply-divider-line" />
    <span className="apply-divider-tick" />
  </div>
);

const HistoryMenu = ({
  entries,
  runs,
  planKey,
  view,
  onSelect,
}: Pick<OutputPanelProps, "entries" | "runs" | "planKey" | "onSelect"> & { view: OutputView }) => (
  <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      <button className="history-trigger" type="button">
        {entryLabel(view.entry, view.run)}
        <span aria-hidden className="caret">
          ▾
        </span>
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content align="start" className="menu" sideOffset={4}>
        {[...entries].reverse().map((entry) => {
          const run = runs[entry.id];
          const state = entryState(entry, run, isOutdated(entry, planKey));

          return (
            <DropdownMenu.Item
              className="menu-item"
              key={entry.id}
              onSelect={() => onSelect(entry.id)}
            >
              <span aria-hidden className="menu-item-current">
                {entry.id === view.entry.id ? "●" : ""}
              </span>
              <span className="menu-item-label">{entryLabel(entry, run)}</span>
              <span className="menu-item-state" data-tone={state.tone}>
                {state.chip}
              </span>
            </DropdownMenu.Item>
          );
        })}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
);

const EntryBody = ({
  view,
  applyRef,
  showUnchanged,
  onPlanAgain,
}: Pick<OutputPanelProps, "showUnchanged" | "onPlanAgain"> & {
  view: OutputView;
  applyRef: Ref<HTMLDivElement>;
}) => {
  const { entry, outdated, run } = view;
  const stale = outdated && run === undefined;

  return (
    <>
      {stale ? (
        <div className="outdated-banner">
          <span className="chip" data-filled="true" data-tone="change">
            Outdated
          </span>
          <p>
            The manifest, its environment values or the connection changed after this plan. Run Plan
            again to apply.
          </p>
          <button className="button" data-variant="secondary" onClick={onPlanAgain} type="button">
            Plan again
          </button>
        </div>
      ) : null}
      <div className="plan" data-outdated={stale}>
        <div className="section-heading">
          <strong>PLAN</strong>
          <span>
            {formatTime(entry.startedAt)} · {entry.projectKey} · <span>{entry.space}</span>
          </span>
        </div>
        <PlanResult
          diagnostics={entry.attempt.diagnostics}
          failure={entry.attempt.failure}
          prepared={entry.attempt.prepared}
          showUnchanged={showUnchanged}
        />
      </div>
      {run === undefined ? null : (
        <div className="apply-section">
          <ApplyDivider ref={applyRef} startedAt={run.startedAt} />
          <ApplyResult run={run} />
        </div>
      )}
    </>
  );
};

export const OutputPanel = ({
  entries,
  runs,
  planKey,
  view,
  applyRequested,
  onApplyFollowed,
  preparing,
  onSelect,
  showUnchanged,
  onShowUnchangedChange,
  onPlanAgain,
}: OutputPanelProps) => {
  const bodyRef = useRef<HTMLDivElement>(null);
  const applyRef = useRef<HTMLDivElement>(null);
  // 項目を移るたびに Plan へ倒す処理を書かない。移る経路（メニュー・新しい計画）ごとに
  // 書き足すことになるので、どの項目のものかと組にして持つ。
  const [reading, setReading] = useState<{ entryId: number; section: Section }>();
  const entryId = view?.entry.id;

  // 組にするだけで済ませない。A → B → A と戻ると A で読んでいた部分が蘇るが、本文は
  // `key` で描き直されて先頭（Plan）にいる。
  if (reading !== undefined && reading.entryId !== entryId) {
    setReading(undefined);
  }

  const section = reading !== undefined && reading.entryId === entryId ? reading.section : "plan";
  const shown = preparing ? undefined : view;
  const prepared = shown?.entry.attempt.prepared;

  const applyStart = (): number | undefined => {
    const divider = applyRef.current;

    return divider === null ? undefined : Math.max(divider.offsetTop - SECTION_MARGIN, 0);
  };

  // 飛んだ先で起きるスクロールを読んでいる位置として拾わない。適用のログが短いと区切りまで
  // 上がりきらず、そのイベントが届く前にログが伸びると、飛んだ直後に Plan へ戻る（WU-49）。
  const jumping = useRef(false);

  const track = (): void => {
    const scroller = bodyRef.current;

    if (jumping.current) {
      jumping.current = false;

      return;
    }

    if (scroller === null || entryId === undefined) {
      return;
    }

    setReading({ entryId, section: sectionAt(scroller, applyStart()) });
  };

  const jumpTo = (target: Section): void => {
    const scroller = bodyRef.current;

    if (entryId === undefined) {
      return;
    }

    setReading({ entryId, section: target });

    if (scroller === null) {
      return;
    }

    const top = Math.min(
      target === "plan" ? 0 : (applyStart() ?? 0),
      scroller.scrollHeight - scroller.clientHeight,
    );

    // 位置が変わらなければスクロールのイベントは来ないので、次の利用者のスクロールを飲み込まない。
    jumping.current = Math.round(scroller.scrollTop) !== Math.round(Math.max(top, 0));
    scroller.scrollTo({ top });
  };

  const applyShown = entryId === applyRequested && shown?.run !== undefined;

  // 追ったことをこの部品の中に覚えない。パネルを畳むとこの部品ごと消えるので、開き直すたびに
  // Apply へ飛び直す。進捗が届くたびに飛ばさないのと同じく、適用の途中で計画を読み返せなくなる（WU-49）。
  useEffect(() => {
    if (applyShown) {
      jumpTo("apply");
      onApplyFollowed();
    }
  }, [applyShown]);

  return (
    <section aria-label="Output" className="output">
      {shown === undefined ? null : (
        <div className="output-header">
          <HistoryMenu
            entries={entries}
            onSelect={onSelect}
            planKey={planKey}
            runs={runs}
            view={shown}
          />
          {shown.run === undefined ? null : (
            <nav aria-label="Sections" className="anchors">
              {SECTIONS.map(({ section: target, title, label }) => (
                <button
                  aria-current={section === target ? "location" : undefined}
                  aria-label={label}
                  key={target}
                  onClick={() => jumpTo(target)}
                  type="button"
                >
                  {title}
                </button>
              ))}
            </nav>
          )}
          <span className="output-header-spacer" />
          {shown.run !== undefined && isRunning(shown.run) ? (
            <span className="applying-note">
              <span aria-hidden className="spinner" />
              Applying. Do not close this tab.
            </span>
          ) : null}
          {prepared === undefined ? null : (
            <label className="toggle">
              <Checkbox.Root
                checked={showUnchanged}
                className="checkbox"
                onCheckedChange={(checked) => onShowUnchangedChange(checked === true)}
              />
              Show unchanged ({summarize(prepared.plan.actions).noop})
            </label>
          )}
        </div>
      )}
      <SectionBoundary>
        {preparing ? (
          <div className="output-empty">
            <p className="output-empty-title" data-busy="true">
              <span aria-hidden className="spinner" />
              Reading the space...
            </p>
          </div>
        ) : null}
        {!preparing && view === undefined ? (
          <div className="output-empty">
            <p className="output-empty-title">Nothing has run yet.</p>
            <p className="output-empty-note">
              Plan reads the space and lists what would change. Nothing is written.
            </p>
          </div>
        ) : null}
        {shown === undefined ? null : (
          <div className="output-content" data-summary={prepared !== undefined}>
            {/* `key` を外さない。別の項目へ移ってもスクロール位置が残る（WU-42）。 */}
            <div className="output-body" key={entryId} onScroll={track} ref={bodyRef}>
              <EntryBody
                applyRef={applyRef}
                onPlanAgain={onPlanAgain}
                showUnchanged={showUnchanged}
                view={shown}
              />
            </div>
            {prepared === undefined ? null : <PlanSummary prepared={prepared} />}
          </div>
        )}
      </SectionBoundary>
    </section>
  );
};
