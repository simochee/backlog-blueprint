import { ChevronDownIcon, ChevronUpIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { Badge, Button, Callout, DropdownMenu, Flex, IconButton, Text } from "@radix-ui/themes";
import { type Ref, useEffect, useRef, useState } from "react";

import { type ApplyRuns, entryLabel, type OutputEntry, type Section, sectionAt } from "../output";
import { type ApplyRun } from "../progress";
import { ApplyResult } from "./apply-result";
import { SectionBoundary } from "./boundary";
import { PlanResult } from "./plan-result";

type OutputView = {
  entry: OutputEntry;
  outdated: boolean;
  run?: ApplyRun;
};

type OutputPanelProps = {
  entries: OutputEntry[];
  runs: ApplyRuns;
  view?: OutputView;
  applyRequested?: number;
  preparing: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onSelect: (id: number) => void;
  showUnchanged: boolean;
  onShowUnchangedChange: (showUnchanged: boolean) => void;
};

/**
 * 表示のまま Plan / Apply と読ませない。エディタの上の Plan / Apply と同じ名前のボタンが
 * 2つずつ並び、押して何が起きるかが名前から区別できない。
 */
const SECTIONS: { section: Section; title: string; label: string }[] = [
  { section: "plan", title: "Plan", label: "Jump to plan" },
  { section: "apply", title: "Apply", label: "Jump to apply" },
];

/** `.output-body` の padding と揃える */
const SECTION_MARGIN = 12;

/** `<hr>` や Radix の `Separator` を使わない。線だけで名前を持てず、「ここから先が適用」を言えない */
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
  applyRequested,
  preparing,
  expanded,
  onExpandedChange,
  onSelect,
  ...body
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

  const followed = useRef<number>(undefined);
  const applyShown = expanded && entryId === applyRequested && view?.run !== undefined;

  // 進捗が届くたびに Apply へ飛ばさない。適用の途中で計画を読み返しに戻れなくなる（WU-49）。
  useEffect(() => {
    if (applyShown && followed.current !== applyRequested) {
      followed.current = applyRequested;
      jumpTo("apply");
    }
  }, [applyShown, applyRequested]);

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
                {[...entries].reverse().map((entry) => (
                  <DropdownMenu.Item key={entry.id} onSelect={() => onSelect(entry.id)}>
                    {entryLabel(entry, runs[entry.id])}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          )}
          {/* 本文の中にだけ出さない。畳んでいても Apply が押せない理由が読めるように（WU-3）。 */}
          {view?.outdated && view.run === undefined ? (
            <Badge color="amber" variant="solid">
              Outdated
            </Badge>
          ) : null}
        </Flex>
        <Flex align="center" gap="3">
          {showSections ? (
            <Flex align="center" aria-label="Sections" asChild gap="1">
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
      </Flex>
      {expanded ? (
        /* `key` を外さない。別の項目へ移ってもスクロール位置が残る（WU-42）。 */
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
