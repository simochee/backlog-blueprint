import { type Action, type ExecutionEvent } from "@backlog-blueprint/core";
import { describe, expect, it } from "vitest";

import {
  foldExecutionEvent,
  idleProgress,
  isRunning,
  rejectedProgress,
  spentPlan,
  type ApplyProgress,
  type ApplyRun,
} from "./progress";

const action = (name: string): Action => ({
  id: `issueTypes/create/${name}`,
  phase: 2,
  kind: "issueType",
  op: "create",
  name,
  writeRequest: true,
});

const BUG = action("バグ");

const TASK = action("タスク");

const fold = (...events: ExecutionEvent[]): ApplyProgress =>
  events.reduce(foldExecutionEvent, idleProgress);

describe("実行イベントを進捗に畳み込む", () => {
  it("行は成否が分かってから足す", () => {
    const started = fold(
      { type: "started", total: 2 },
      {
        type: "actionStarted",
        index: 0,
        total: 2,
        action: BUG,
      },
    );

    expect(started.lines).toStrictEqual([]);

    const done = foldExecutionEvent(started, {
      type: "actionSucceeded",
      action: BUG,
      response: {},
      resolved: [],
    });

    expect(done.lines).toStrictEqual(['[1/2] + issueType      "バグ" ... done']);
  });

  it("待機は捨てずに行として残す", () => {
    const waiting = fold(
      { type: "started", total: 2 },
      { type: "actionStarted", index: 0, total: 2, action: BUG },
      { type: "waiting", seconds: 42 },
    );

    expect(waiting.lines).toStrictEqual([
      '[1/2] + issueType      "バグ" ... rate limited, waiting 42s',
    ]);
  });

  it("成功した Action の数だけ進む", () => {
    const progress = fold(
      { type: "started", total: 2 },
      { type: "actionStarted", index: 0, total: 2, action: BUG },
      { type: "actionSucceeded", action: BUG, response: {}, resolved: [] },
    );

    expect(progress.completed).toBe(1);
    expect(progress.total).toBe(2);
  });

  it("全件成功すると適用済みの一覧を持つ結果になる", () => {
    const progress = fold(
      { type: "started", total: 1 },
      { type: "actionStarted", index: 0, total: 1, action: BUG },
      { type: "actionSucceeded", action: BUG, response: {}, resolved: [] },
      { type: "finished" },
    );

    expect(progress.outcome).toStrictEqual({ result: "succeeded", applied: [BUG] });
  });

  it("中断すると適用済み・失敗・未適用の3つに分かれる", () => {
    const progress = fold(
      { type: "started", total: 2 },
      { type: "actionStarted", index: 0, total: 2, action: BUG },
      { type: "actionFailed", action: BUG, status: 400, errors: [{ message: "bad request" }] },
      { type: "aborted", applied: [], failed: BUG, pending: [TASK] },
    );

    expect(progress.outcome).toStrictEqual({
      result: "aborted",
      applied: [],
      failed: { action: BUG, status: 400, errors: [{ message: "bad request" }] },
      pending: [TASK],
    });
  });

  it("HTTP まで届かなかった失敗は状態コードを持たないまま報告する", () => {
    const progress = fold(
      { type: "started", total: 1 },
      { type: "actionStarted", index: 0, total: 1, action: BUG },
      { type: "actionFailed", action: BUG, errors: [{ message: "Failed to fetch" }] },
      { type: "aborted", applied: [], failed: BUG, pending: [] },
    );

    expect(progress.outcome).toStrictEqual({
      result: "aborted",
      applied: [],
      failed: { action: BUG, errors: [{ message: "Failed to fetch" }] },
      pending: [],
    });
  });
});

const run = (progress: ApplyProgress, failure?: unknown): ApplyRun => ({
  progress,
  projectKey: "PROJ_A",
  space: "example.backlog.com",
  ...(failure === undefined ? {} : { failure }),
});

const applying = fold(
  { type: "started", total: 2 },
  { type: "actionStarted", index: 0, total: 2, action: BUG },
  { type: "actionSucceeded", action: BUG, response: {}, resolved: [] },
);

const succeeded = foldExecutionEvent(applying, { type: "finished" });

const abortedRun = fold(
  { type: "started", total: 2 },
  { type: "actionStarted", index: 0, total: 2, action: BUG },
  { type: "actionFailed", action: BUG, status: 400, errors: [{ message: "bad request" }] },
  { type: "aborted", applied: [], failed: BUG, pending: [TASK] },
);

describe("実行中かどうかは記録そのものから読む", () => {
  it("結末が出るまでが実行中", () => {
    expect(isRunning(run(idleProgress))).toBe(true);
    expect(isRunning(run(applying))).toBe(true);
  });

  it("完了・中断・拒否のいずれも実行中ではない", () => {
    expect(isRunning(run(succeeded))).toBe(false);
    expect(isRunning(run(abortedRun))).toBe(false);
    expect(isRunning(run(rejectedProgress))).toBe(false);
  });

  it("送信そのものが失敗したときも実行中ではない", () => {
    expect(isRunning(run(applying, new TypeError("Failed to fetch")))).toBe(false);
  });
});

describe("計画を使い切ったかどうか", () => {
  it("完了と中断はその計画を使い切る", () => {
    expect(spentPlan(run(succeeded))).toBe(true);
    expect(spentPlan(run(abortedRun))).toBe(true);
  });

  it("送信そのものが失敗したときも使い切る", () => {
    expect(spentPlan(run(applying, new TypeError("Failed to fetch")))).toBe(true);
  });

  it("断られた確認は使い切らない", () => {
    expect(spentPlan(run(rejectedProgress))).toBe(false);
  });

  it("走っている途中の計画はまだ使い切っていない", () => {
    expect(spentPlan(run(applying))).toBe(false);
  });
});
