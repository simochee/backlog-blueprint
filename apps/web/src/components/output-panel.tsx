import { ChevronDownIcon, ChevronUpIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { Badge, Button, Callout, DropdownMenu, Flex, IconButton, Text } from "@radix-ui/themes";

import { type ApplyRuns, entryLabel, type OutputEntry } from "../output";
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
 * `<hr>` と Radix の `Separator` を使わない。どちらも線だけで名前を持てず、読み上げでも
 * 見た目でも「ここから先が適用」を言えない。
 */
const ApplyDivider = () => (
  <div aria-label="Apply" className="output-divider" role="separator">
    <Text color="gray" size="1" weight="medium">
      Apply
    </Text>
  </div>
);

const EntryBody = ({
  view,
  showUnchanged,
  onShowUnchangedChange,
}: Pick<OutputPanelProps, "showUnchanged" | "onShowUnchangedChange"> & { view: OutputView }) => {
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
          <ApplyDivider />
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
}: OutputPanelProps) => (
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
      <div className="output-body">
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
          {!preparing && view !== undefined ? <EntryBody view={view} {...body} /> : null}
        </SectionBoundary>
      </div>
    ) : null}
  </section>
);
