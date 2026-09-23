import { type Action } from "@backlog-blueprint/core";
import { describe, expect, it } from "vitest";

import {
  appendEntry,
  applicableEntry,
  entryLabel,
  isOutdated,
  sectionAt,
  type ApplyContext,
  type NewEntry,
  type OutputEntry,
} from "./output";
import { type PreparedPlan } from "./plan";
import { idleProgress, type ApplyProgress, type ApplyRun } from "./progress";

const action = (op: Action["op"]): Action => ({
  id: `issueTypes/${op}/タスク`,
  phase: 2,
  kind: "issueType",
  op,
  name: "タスク",
  writeRequest: op !== "noop",
});

/**
 * 変更があるかどうかは Action の並びだけで決まる。スナップショットや解決表まで
 * 組み立てると、何がこの判定に効いているのかがテストから読めなくなる。
 */
const preparedWith = (...actions: Action[]): PreparedPlan =>
  ({ plan: { actions } }) as unknown as PreparedPlan;

const STAMP = "inputs at the time of planning";

const entry = (overrides: Partial<NewEntry> = {}): NewEntry => ({
  startedAt: new Date(2026, 8, 23, 14, 2, 31).getTime(),
  space: "example.backlog.com",
  projectKey: "PROJ_A",
  stamp: STAMP,
  attempt: { diagnostics: [], prepared: preparedWith(action("create")) },
  ...overrides,
});

const historyOf = (...entries: NewEntry[]): OutputEntry[] => entries.reduce(appendEntry, []);

const context = (history: OutputEntry[], overrides: Partial<ApplyContext> = {}): ApplyContext => ({
  history,
  runs: {},
  planKey: STAMP,
  pending: false,
  ...overrides,
});

const runWith = (progress: ApplyProgress): ApplyRun => ({
  progress,
  projectKey: "PROJ_A",
  space: "example.backlog.com",
});

const succeeded = runWith({ ...idleProgress, outcome: { result: "succeeded", applied: [] } });

describe("Output の履歴", () => {
  it("足した順に 1 から番号が振られる", () => {
    expect(historyOf(entry(), entry()).map(({ id }) => id)).toStrictEqual([1, 2]);
  });

  it("見出しは時刻を 24 時間表記で出し、プロジェクトキーを並べる", () => {
    const [first] = historyOf(entry());

    expect(first === undefined ? "" : entryLabel(first)).toBe("14:02:31 · PROJ_A");
  });

  it("適用した項目の見出しには、適用の結末が付く", () => {
    const [first] = historyOf(entry());

    expect(first === undefined ? "" : entryLabel(first, runWith(idleProgress))).toBe(
      "14:02:31 · PROJ_A · Applying",
    );
    expect(first === undefined ? "" : entryLabel(first, succeeded)).toBe(
      "14:02:31 · PROJ_A · Applied",
    );
  });
});

describe("Apply できる計画", () => {
  it("最新の計画が今の入力で作ったもので、変更があり、まだ適用していなければ Apply できる", () => {
    const history = historyOf(entry());

    expect(applicableEntry(context(history))).toBe(history[0]);
  });

  it("前の計画ではなく、最新の計画を適用する", () => {
    const history = historyOf(entry(), entry());

    expect(applicableEntry(context(history))?.id).toBe(2);
  });

  it("計画を作った後に入力が変わっていれば Apply できない", () => {
    expect(applicableEntry(context(historyOf(entry()), { planKey: "edited" }))).toBeUndefined();
  });

  it("変更が無ければ Apply できない", () => {
    const history = historyOf(
      entry({ attempt: { diagnostics: [], prepared: preparedWith(action("noop")) } }),
    );

    expect(applicableEntry(context(history))).toBeUndefined();
  });

  it("計画が出なかったときは Apply できない", () => {
    expect(
      applicableEntry(context(historyOf(entry({ attempt: { diagnostics: [] } })))),
    ).toBeUndefined();
  });

  it("一度適用した計画には、終わった後でも Apply できない", () => {
    const history = historyOf(entry());

    expect(applicableEntry(context(history, { runs: { 1: succeeded } }))).toBeUndefined();
  });

  it("適用している最中は、別の計画にも Apply できない", () => {
    const history = historyOf(entry(), entry());

    expect(
      applicableEntry(context(history, { runs: { 1: runWith(idleProgress) } })),
    ).toBeUndefined();
  });

  it("次の計画を組み立てている最中は Apply できない", () => {
    expect(applicableEntry(context(historyOf(entry()), { pending: true }))).toBeUndefined();
  });

  it("計画がまだ無ければ Apply できない", () => {
    expect(applicableEntry(context([]))).toBeUndefined();
  });
});

describe("計画が古くなったか", () => {
  it("作ったときから入力が変わっていれば古い", () => {
    const [first] = historyOf(entry());

    expect(first === undefined ? undefined : isOutdated(first, STAMP)).toBe(false);
    expect(first === undefined ? undefined : isOutdated(first, "edited")).toBe(true);
  });
});

const APPLY_START = 400;

const position = (scrollTop: number) => ({ scrollTop, clientHeight: 300, scrollHeight: 1000 });

describe("読んでいる部分", () => {
  it("Apply の区切りが上端に届くまでは Plan", () => {
    expect(sectionAt(position(0), APPLY_START)).toBe("plan");
    expect(sectionAt(position(399), APPLY_START)).toBe("plan");
  });

  it("Apply の区切りが上端に届いたら Apply", () => {
    expect(sectionAt(position(400), APPLY_START)).toBe("apply");
  });

  it("適用のログが短くて区切りが上端まで上がらなくても、最後までスクロールすれば Apply", () => {
    expect(sectionAt(position(700), 850)).toBe("apply");
  });

  it("スクロールしなくても全部見えているときは Plan", () => {
    expect(sectionAt({ scrollTop: 0, clientHeight: 300, scrollHeight: 300 }, 200)).toBe("plan");
  });

  it("適用していない項目は常に Plan", () => {
    expect(sectionAt(position(700), undefined)).toBe("plan");
  });
});
