import { ChevronDownIcon, ChevronUpIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { Badge, Button, Callout, DropdownMenu, Flex, IconButton, Text } from "@radix-ui/themes";
import { type Ref, useRef, useState } from "react";

import { type ApplyRuns, entryLabel, type OutputEntry, type Section, sectionAt } from "../output";
import { type ApplyRun } from "../progress";
import { ApplyResult } from "./apply-result";
import { SectionBoundary } from "./boundary";
import { PlanResult } from "./plan-result";

export type OutputView = {
  entry: OutputEntry;
  outdated: boolean;
  run?: ApplyRun;
};

export type OutputPanelProps = {
  entries: OutputEntry[];
  runs: ApplyRuns;
  view?: OutputView;
  /** 次の項目を組み立てている最中で、かつ最新の項目を追って表示している */
  preparing: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onSelect: (id: number) => void;
  showUnchanged: boolean;
  onShowUnchangedChange: (showUnchanged: boolean) => void;
};

/**
 * 読み上げの名前を表示と分ける。表示のまま Plan / Apply と読ませると、エディタの上の
 * Plan / Apply（計画を作る・適用する）と同じ名前のボタンが2つずつ並び、押して何が起きるかが
 * 名前から区別できない。
 */
const SECTIONS: { section: Section; title: string; label: string }[] = [
  { section: "plan", title: "Plan", label: "Jump to plan" },
  { section: "apply", title: "Apply", label: "Jump to apply" },
];

/** Apply へ飛んだとき、区切りの上に残す余白。`.output-body` の padding と揃える */
const SECTION_MARGIN = 12;

/**
 * `<hr>` と Radix の `Separator` を使わない。どちらも線だけで名前を持てず、読み上げでも
 * 見た目でも「ここから先が適用」を言えない。
 */
const ApplyDivider = ({ ref }: { ref: Ref<HTMLDivElement> }) => (
  <div aria-label="Apply" className="output-divider" ref={ref} role="separator">
    <Text color="gray" size="1" weight="medium">
      Apply
    </Text>
  </div>
);

const EntryBody = ({
  view,
  applyRef,
  showUnchanged,
  onShowUnchangedChange,
}: Pick<OutputPanelProps, "showUnchanged" | "onShowUnchangedChange"> & {
  view: OutputView;
  applyRef: Ref<HTMLDivElement>;
}) => {
  const { entry, outdated, run } = view;

  return (
    <Flex direction="column" gap="4">
      <Flex align="center" gap="2" wrap="wrap">
        <Text size="2" weight="bold">
          {entryLabel(entry, run)}
        </Text>
        <Text color="gray" size="1">
          {entry.space}
        </Text>
      </Flex>
      {outdated && run === undefined ? (
        <Callout.Root color="amber" size="1" variant="surface">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>
            The manifest, its environment values or the connection changed after this plan. Run Plan
            again to apply.
          </Callout.Text>
        </Callout.Root>
      ) : null}
      <PlanResult
        diagnostics={entry.attempt.diagnostics}
        failure={entry.attempt.failure}
        onShowUnchangedChange={onShowUnchangedChange}
        prepared={entry.attempt.prepared}
        showUnchanged={showUnchanged}
      />
      {run === undefined ? null : (
        <>
          <ApplyDivider ref={applyRef} />
          <ApplyResult run={run} />
        </>
      )}
    </Flex>
  );
};

export const OutputPanel = ({
  entries,
  runs,
  view,
  preparing,
  expanded,
  onExpandedChange,
  onSelect,
  ...body
}: OutputPanelProps) => {
  const bodyRef = useRef<HTMLDivElement>(null);
  const applyRef = useRef<HTMLDivElement>(null);
  /**
   * 読んでいる部分は、どの項目のものかと組にして持つ。項目を移ったら Plan から読み始めるが、
   * 移るたびに倒す処理を書くと、移る経路（メニュー・新しい計画）ごとに書き足すことになる。
   */
  const [reading, setReading] = useState<{ entryId: number; section: Section }>();
  const entryId = view?.entry.id;
  const section = reading !== undefined && reading.entryId === entryId ? reading.section : "plan";
  const showSections = expanded && entryId !== undefined && view?.run !== undefined && !preparing;

  const applyStart = (): number | undefined => {
    const divider = applyRef.current;

    return divider === null ? undefined : Math.max(divider.offsetTop - SECTION_MARGIN, 0);
  };

  const track = (): void => {
    const scroller = bodyRef.current;

    if (scroller === null || entryId === undefined) {
      return;
    }

    setReading({ entryId, section: sectionAt(scroller, applyStart()) });
  };

  const jumpTo = (target: Section): void => {
    if (entryId === undefined) {
      return;
    }

    setReading({ entryId, section: target });
    bodyRef.current?.scrollTo({ top: target === "plan" ? 0 : (applyStart() ?? 0) });
  };

  return (
    <section aria-label="Output" className="output-panel" data-expanded={expanded}>
      <Flex align="center" className="output-header" gap="3" justify="between">
        <Flex align="center" gap="3" minWidth="0">
          <Text size="2" weight="medium">
            Output
          </Text>
          {view === undefined ? null : (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                <Button color="gray" size="1" variant="soft">
                  <span className="output-current">{entryLabel(view.entry, view.run)}</span>
                  <DropdownMenu.TriggerIcon />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="start" size="1">
                {/**
                 * `toReversed` に置き換えない。基底の tsconfig が `lib: ES2022` を置いているため、
                 * ES2023 のメソッドは型検査で落ちる。複製済みの配列を裏返すので破壊的でもない。
                 */}
                {/* oxlint-disable-next-line unicorn/no-array-reverse */}
                {[...entries].reverse().map((entry) => (
                  <DropdownMenu.Item key={entry.id} onSelect={() => onSelect(entry.id)}>
                    {entryLabel(entry, runs[entry.id])}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          )}
          {/* 畳んでいても見える場所に出す。Apply が押せない理由がここで読める（WU-3）。 */}
          {view?.outdated && view.run === undefined ? (
            <Badge color="amber" variant="solid">
              Outdated
            </Badge>
          ) : null}
          {showSections ? (
            <Flex aria-label="Sections" asChild gap="1">
              <nav>
                {SECTIONS.map(({ section: target, title, label }) => (
                  <Button
                    aria-current={section === target ? "location" : undefined}
                    aria-label={label}
                    color="gray"
                    key={target}
                    onClick={() => jumpTo(target)}
                    size="1"
                    type="button"
                    variant={section === target ? "solid" : "ghost"}
                  >
                    {title}
                  </Button>
                ))}
              </nav>
            </Flex>
          ) : null}
        </Flex>
        <IconButton
          aria-expanded={expanded}
          aria-label={expanded ? "Minimize output" : "Expand output"}
          color="gray"
          onClick={() => onExpandedChange(!expanded)}
          size="1"
          variant="ghost"
        >
          {expanded ? <ChevronDownIcon /> : <ChevronUpIcon />}
        </IconButton>
      </Flex>
      {expanded ? (
        /* 項目ごとに器を作り直し、別の項目へ移ったら先頭から表示する（WU-42）。 */
        <div className="output-body" key={entryId} onScroll={track} ref={bodyRef}>
          <SectionBoundary>
            {preparing ? (
              <Text color="gray" size="2">
                Reading the space...
              </Text>
            ) : null}
            {!preparing && view === undefined ? (
              <Text color="gray" size="2">
                Nothing has run yet.
              </Text>
            ) : null}
            {!preparing && view !== undefined ? (
              <EntryBody applyRef={applyRef} view={view} {...body} />
            ) : null}
          </SectionBoundary>
        </div>
      ) : null}
    </section>
  );
};
