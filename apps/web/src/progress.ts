import {
  progressOutcome,
  renderProgress,
  type Action,
  type ApplyOutcome,
  type ExecutionEvent,
  type ResolutionTable,
} from "@backlog-blueprint/core";

type Started = { index: number; total: number; action: Action };

export type ProgressMark = "done" | "failed" | "waiting";

export type ProgressEntry = { text: string; mark: ProgressMark };

export type ApplyProgress = {
  total: number;
  completed: number;
  lines: ProgressEntry[];
  applied: Action[];
  started?: Started;
  failure?: { status?: number; errors: { message: string }[] };
  outcome?: ApplyOutcome;
};

export const idleProgress: ApplyProgress = { total: 0, completed: 0, lines: [], applied: [] };

export type ApplyRun = {
  startedAt: number;
  progress: ApplyProgress;
  resolutions?: ResolutionTable;
  projectKey: string;
  space: string;
  failure?: unknown;
};

/** 実行中の真偽値を別に持たない。結末と食い違う状態が書けてしまう（WU-17） */
export const isRunning = ({ progress, failure }: ApplyRun): boolean =>
  progress.outcome === undefined && failure === undefined;

const withLine = (state: ApplyProgress, event: ExecutionEvent): ApplyProgress => {
  const outcome = progressOutcome(event);

  if (state.started === undefined || outcome === undefined) {
    return state;
  }

  return {
    ...state,
    lines: [
      ...state.lines,
      {
        text: renderProgress({ ...state.started, outcome }, { color: false }),
        mark: typeof outcome === "string" ? outcome : "waiting",
      },
    ],
  };
};

/** 進捗の行を `actionStarted` で足さない。成否を持つのはその次のイベントである（core §7） */
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
