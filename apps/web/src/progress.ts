import {
  renderProgress,
  type Action,
  type ApplyOutcome,
  type ExecutionEvent,
  type ProgressOutcome,
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

/**
 * `waiting` を行にする。捨てると、429 を受けて待っている間 apply が黙って止まって
 * 見える（plan の出力仕様 §3.1）。
 */
const outcomeOf = (event: ExecutionEvent): ProgressOutcome | undefined => {
  if (event.type === "actionSucceeded") {
    return "done";
  }

  if (event.type === "actionFailed") {
    return "failed";
  }

  return event.type === "waiting" ? { waitingSeconds: event.seconds } : undefined;
};

const withLine = (state: ApplyProgress, event: ExecutionEvent): ApplyProgress => {
  const outcome = outcomeOf(event);

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
