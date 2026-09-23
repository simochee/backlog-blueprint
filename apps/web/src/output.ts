import { summarize } from "@backlog-blueprint/core";

import { type PlanAttempt } from "./plan";
import { isRunning, type ApplyRun } from "./progress";

export type OutputEntry = {
  id: number;
  startedAt: number;
  space: string;
  projectKey: string;
  /** 計画を作ったときの入力の印（WU-3）。今の印と違えば、この計画は今の入力から作ったものではない */
  stamp: string;
  attempt: PlanAttempt;
};

export type NewEntry = Omit<OutputEntry, "id">;

/** 適用した項目の記録。項目の番号で引く */
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
  /** 次の計画を組み立てている最中。それが足されれば今の最新は最新でなくなる */
  pending: boolean;
};

/**
 * WU-3。押せるかどうかを state に持たず、履歴と入力から導く。持てば条件が外れる経路ごとに
 * 倒す処理が要り、1つ漏れれば古い計画を適用できる。
 */
export const applicableEntry = ({
  history,
  runs,
  planKey,
  pending,
}: ApplyContext): OutputEntry | undefined => {
  const latest = history.at(-1);
  const prepared = latest?.attempt.prepared;

  if (latest === undefined || prepared === undefined || pending) {
    return undefined;
  }

  if (Object.values(runs).some(isRunning) || runs[latest.id] !== undefined) {
    return undefined;
  }

  if (isOutdated(latest, planKey) || !summarize(prepared.plan.actions).hasChanges) {
    return undefined;
  }

  return latest;
};

const runStatus = (run: ApplyRun | undefined): string | undefined => {
  if (run === undefined) {
    return undefined;
  }

  if (isRunning(run)) {
    return "Applying";
  }

  return run.progress.outcome?.result === "succeeded" ? "Applied" : "Aborted";
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

export const entryLabel = ({ startedAt, projectKey }: OutputEntry, run?: ApplyRun): string =>
  [TIME.format(startedAt), projectKey, runStatus(run)].filter(Boolean).join(" · ");

export type Section = "plan" | "apply";

export type ScrollPosition = { scrollTop: number; clientHeight: number; scrollHeight: number };

/**
 * WU-42。`applyStart` は Apply へ飛んだときに止まる位置。最後までスクロールしたら Apply に
 * する — 適用のログが短いと区切りが上端まで上がりきらない。スクロールできない長さ（`scrollTop`
 * が 0 のまま）なら両方が見えているので、先頭の Plan にしておく。
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
