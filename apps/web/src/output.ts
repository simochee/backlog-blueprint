import { summarize } from "@backlog-blueprint/core";

import { type PlanAttempt } from "./plan";
import { isRunning, type ApplyRun } from "./progress";

export type OutputEntry = {
  id: number;
  startedAt: number;
  space: string;
  projectKey: string;
  stamp: string;
  attempt: PlanAttempt;
};

export type NewEntry = Omit<OutputEntry, "id">;

export type ApplyRuns = Record<number, ApplyRun>;

export const appendEntry = (history: OutputEntry[], entry: NewEntry): OutputEntry[] => [
  ...history,
  { ...entry, id: (history.at(-1)?.id ?? 0) + 1 },
];

export const isOutdated = (entry: OutputEntry, planKey: string): boolean => entry.stamp !== planKey;

export type ApplyContext = {
  history: OutputEntry[];
  runs: ApplyRuns;
  planKey: string;
  pending: boolean;
};

/**
 * 押せない理由を押せるかどうかと別の関数に書かない。条件が2か所に分かれると、片方だけ
 * 書き足したときに「押せないのに理由が出ない」か「理由が出るのに押せる」になる（WU-52）。
 */
export const applyBlocker = ({
  history,
  runs,
  planKey,
  pending,
}: ApplyContext): string | undefined => {
  const latest = history.at(-1);

  if (Object.values(runs).some(isRunning)) {
    return "Apply is running";
  }

  if (pending) {
    return "Plan is running";
  }

  if (latest === undefined) {
    return "Run Plan first";
  }

  if (runs[latest.id] !== undefined) {
    return "This plan is already applied";
  }

  const { prepared } = latest.attempt;

  if (prepared === undefined) {
    return "The plan stopped. Fix the problems and run Plan again.";
  }

  if (isOutdated(latest, planKey)) {
    return "The plan is outdated. Run Plan again.";
  }

  return summarize(prepared.plan.actions).hasChanges ? undefined : "The plan has no changes";
};

/**
 * 押せるかどうかを state に持たない。持てば条件が外れる経路ごとに倒す処理が要り、
 * 1つ漏れれば古い計画を適用できる（WU-3）。
 */
export const applicableEntry = (context: ApplyContext): OutputEntry | undefined =>
  applyBlocker(context) === undefined ? context.history.at(-1) : undefined;

export type Tone = "add" | "change" | "destroy" | "refresh" | "weak";

export type EntryState = {
  label: string;
  chip: string;
  tone: Tone;
  filled: boolean;
};

export const PLANNING: EntryState = {
  label: "Planning",
  chip: "Planning",
  tone: "weak",
  filled: false,
};

/** 塗りを増やさない。塗るのはやり直しが要るものだけで、増やすとどれに手を打つかが読めなくなる（WU-53） */
export const entryState = (
  entry: OutputEntry,
  run: ApplyRun | undefined,
  outdated: boolean,
): EntryState => {
  if (run !== undefined) {
    const { completed, total, outcome } = run.progress;

    if (isRunning(run)) {
      return {
        label: "Applying",
        chip: `Applying ${completed}/${total}`,
        tone: "refresh",
        filled: false,
      };
    }

    return outcome?.result === "succeeded"
      ? { label: "Applied", chip: "Applied", tone: "add", filled: false }
      : { label: "Apply aborted", chip: "Aborted", tone: "destroy", filled: true };
  }

  if (entry.attempt.prepared === undefined) {
    return { label: "Plan stopped", chip: "Stopped", tone: "destroy", filled: true };
  }

  return outdated
    ? { label: "Planned", chip: "Outdated", tone: "change", filled: true }
    : { label: "Planned", chip: "Planned", tone: "add", filled: false };
};

/**
 * 時刻の書式は実行環境の言語に任せない。画面に出る文字は英語だけ（NFR-9）で、
 * 既定のロケールに任せると日本語の環境で「午後2:02:31」が混ざる。
 */
const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export const formatTime = (time: number): string => TIME.format(time);

export const entryLabel = (entry: OutputEntry, run?: ApplyRun): string =>
  [formatTime(entry.startedAt), entry.projectKey, entryState(entry, run, false).label].join(" · ");

export type Section = "plan" | "apply";

type ScrollPosition = { scrollTop: number; clientHeight: number; scrollHeight: number };

/**
 * `applyStart` を越えたかだけで決めない。適用のログが短いと区切りが上端まで上がりきらないので、
 * 最後までスクロールしたら Apply にする。スクロールできない長さなら両方見えているので Plan（WU-42）。
 */
export const sectionAt = (
  { scrollTop, clientHeight, scrollHeight }: ScrollPosition,
  applyStart: number | undefined,
): Section => {
  if (applyStart === undefined) {
    return "plan";
  }

  const atEnd = scrollTop > 0 && scrollTop + clientHeight >= scrollHeight - 1;

  return atEnd || scrollTop >= applyStart ? "apply" : "plan";
};
