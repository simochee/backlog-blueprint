import {
  progressOutcome,
  renderProgress,
  type Action,
  type ApplyOutcome,
  type ExecutionEvent,
  type ResolutionTable,
} from "@backlog-blueprint/core";

type Started = { index: number; total: number; action: Action };

export type ApplyProgress = {
  total: number;
  completed: number;
  lines: string[];
  applied: Action[];
  started?: Started;
  failure?: { status?: number; errors: { message: string }[] };
  outcome?: ApplyOutcome;
};

export const idleProgress: ApplyProgress = { total: 0, completed: 0, lines: [], applied: [] };

export const rejectedProgress: ApplyProgress = { ...idleProgress, outcome: { result: "rejected" } };

export type ApplyRun = {
  progress: ApplyProgress;
  resolutions?: ResolutionTable;
  projectKey: string;
  space: string;
  failure?: unknown;
};

/**
 * 実行中かどうかを別の真偽値で持たない（WU-17）。`execute` は必ず `finished` か
 * `aborted` で終わる（core §7）ので、終わったことは記録そのものが持っている。
 * 別に持つと、進捗の最後の1件と「終わった」が別々の描画に乗りうる。
 */
export const isRunning = ({ progress, failure }: ApplyRun): boolean =>
  progress.outcome === undefined && failure === undefined;

/**
 * その計画を使い切ったかどうか（WU-3 (b)）。断られた確認は使い切らないので、同じ計画に
 * もう一度 Apply を押せる。終わり方ごとに印を置く形にしないのは、終わり方が1つ増えたときに
 * 書き忘れた経路だけ同じ計画を2度適用できるからである。
 */
export const spentPlan = (run: ApplyRun): boolean =>
  !isRunning(run) && run.progress.outcome?.result !== "rejected";

const withLine = (state: ApplyProgress, event: ExecutionEvent): ApplyProgress => {
  const outcome = progressOutcome(event);

  if (state.started === undefined || outcome === undefined) {
    return state;
  }

  return {
    ...state,
    lines: [...state.lines, renderProgress({ ...state.started, outcome }, { color: false })],
  };
};

/**
 * 進捗の行は成否が分かってから足す。位置を持つのは `actionStarted` だけで、成否を持つのは
 * その次のイベントである（core §7）。色は CSS で付けるので `painter(false)` を渡す。
 */
export const foldExecutionEvent = (state: ApplyProgress, event: ExecutionEvent): ApplyProgress => {
  if (event.type === "started") {
    return { ...state, total: event.total };
  }

  if (event.type === "actionStarted") {
    return { ...state, started: { index: event.index, total: event.total, action: event.action } };
  }

  if (event.type === "actionSucceeded") {
    const advanced = withLine(state, event);

    return {
      ...advanced,
      completed: advanced.completed + 1,
      applied: [...advanced.applied, event.action],
    };
  }

  if (event.type === "actionFailed") {
    return {
      ...withLine(state, event),
      failure:
        event.status === undefined
          ? { errors: event.errors }
          : { status: event.status, errors: event.errors },
    };
  }

  if (event.type === "waiting") {
    return withLine(state, event);
  }

  if (event.type === "finished") {
    return { ...state, outcome: { result: "succeeded", applied: state.applied } };
  }

  return {
    ...state,
    outcome: {
      result: "aborted",
      applied: event.applied,
      failed: { action: event.failed, ...(state.failure ?? { errors: [] }) },
      pending: event.pending,
    },
  };
};
