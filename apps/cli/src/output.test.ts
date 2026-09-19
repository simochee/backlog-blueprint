import { describe, expect, it } from "vitest";

import { type Action, type ExecutionEvent } from "@backlog-blueprint/core";

import { createOutput } from "./output";

const action: Action = {
  id: "statuses/create/レビュー中",
  phase: 3,
  kind: "status",
  op: "create",
  name: "レビュー中",
  request: {
    method: "POST",
    path: "/api/v2/projects/PROJ_A/statuses",
    params: { name: "レビュー中", color: "#3b9dbd" },
  },
  writeRequest: true,
};

const started: ExecutionEvent = { type: "actionStarted", index: 4, total: 10, action };

const lines = (...events: ExecutionEvent[]): (string | undefined)[] => {
  const output = createOutput();

  return events.map((event) => output.progress(event, { color: false }));
};

describe("適用の進捗", () => {
  it("開始しただけでは行を書かない", () => {
    expect(lines(started)).toEqual([undefined]);
  });

  it("成否が分かってから位置と結果を1行にまとめる", () => {
    expect(lines(started, { type: "actionSucceeded", action, response: {}, resolved: [] })).toEqual(
      [undefined, '[ 5/10] + status         "レビュー中" ... done\n'],
    );
  });

  it("レート制限で待つ間も、待っている Action の行として書く", () => {
    expect(lines(started, { type: "waiting", seconds: 42 })).toEqual([
      undefined,
      '[ 5/10] + status         "レビュー中" ... rate limited, waiting 42s\n',
    ]);
  });

  it("実行と関わらないイベントは行にならない", () => {
    expect(lines({ type: "started", total: 10 }, { type: "finished" })).toEqual([
      undefined,
      undefined,
    ]);
  });
});
