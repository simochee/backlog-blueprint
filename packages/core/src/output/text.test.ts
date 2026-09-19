import { describe, expect, it } from "vitest";

import { type Action } from "../action";
import { type ResolutionTable } from "../resolution";
import { Secret } from "../secret";
import { walkthroughActions, walkthroughReport } from "./fixtures";
import {
  APPLY_CONFIRMATION,
  renderApplyAbort,
  renderApplyComplete,
  renderApplyResult,
  renderHttpFailure,
  renderPlanText,
  renderProgress,
} from "./text";

const actionOf = (id: string): Action => {
  const action = walkthroughActions().find((candidate) => candidate.id === id);

  if (action === undefined) {
    throw new Error(`No fixture action ${id}`);
  }

  return action;
};

const ESCAPE = String.fromCharCode(27);

const executed = (): Action[] => walkthroughActions().filter(({ op }) => op !== "noop");

describe("plan の人間向け出力", () => {
  it("記号・変更点・警告・集計をこの順で並べる", () => {
    expect(renderPlanText(walkthroughReport())).toBe(
      `Blueprint: PROJ_A (example.backlog.com)
Project does not exist and will be created.

  + project        PROJ_A  "プロジェクトA"
  ↻ refresh        reading back default issue types and statuses
  ~ issueType      "バグ"
      templateSummary: (none) -> "【不具合】"
  ~ issueType      "調査"  renamed from "その他"
  - issueType      "要望"
  + status         "レビュー中"  color "#3b9dbd"
  ~ statusOrder    未対応, 処理中, レビュー中, 処理済み, 完了
  + projectTeam    "開発チーム"
  + projectMember  "suzuki"
  + webhook        "Slack 通知"  hookUrl ***

Warnings:
  ! [V-A16] access.members: "suzuki" already belongs to team "開発チーム"
      Remove it from access.members to save one write request.

Plan: 5 to add, 3 to change, 1 to destroy, 5 unchanged.
Write requests: 9 (estimated 9s)
`,
    );
  });

  it("一致しているリソースは表示されず、件数だけが集計に出る", () => {
    const text = renderPlanText(walkthroughReport());

    expect(text).not.toContain("= issueType");
    expect(text).toContain("5 unchanged.");
  });

  it("--show-unchanged では一致しているリソースも適用順に並ぶ", () => {
    expect(renderPlanText(walkthroughReport(), { showUnchanged: true })).toContain(
      '= issueType      "タスク"',
    );
  });

  it("リネームは作成ではなく更新として描かれ、旧名を添える", () => {
    expect(renderPlanText(walkthroughReport())).toContain(
      '  ~ issueType      "調査"  renamed from "その他"',
    );
  });

  it("新規プロジェクトの枠の引き継ぎは作成として描かれ、引き継ぎ元を示さない", () => {
    const adopted: Action = {
      id: "issueTypes/create/タスク",
      phase: 2,
      kind: "issueType",
      op: "create",
      name: "タスク",
      target: { $ref: { kind: "issueType", name: "タスク" } },
      request: {
        method: "PATCH",
        path: "/api/v2/projects/PROJ_A/issueTypes/{$ref:issueType:タスク}",
        params: { name: "タスク", color: "#7ea800" },
      },
      writeRequest: true,
    };

    const text = renderPlanText(walkthroughReport({ actions: [adopted], diagnostics: [] }));

    expect(text).toContain('  + issueType      "タスク"  color "#7ea800"');
    expect(text).not.toContain("renamed from");
  });

  it("余った既定の枠の削除は位置ではなく用途で描かれる", () => {
    const slot: Action = {
      id: "issueTypes/delete/slot/3",
      phase: 2,
      kind: "issueType",
      op: "delete",
      name: "3",
      target: { $ref: { kind: "issueTypeSlot", name: "3" } },
      request: {
        method: "DELETE",
        path: "/api/v2/projects/PROJ_A/issueTypes/{$ref:issueTypeSlot:3}",
        params: { substituteIssueTypeId: { $ref: { kind: "issueType", name: "タスク" } } },
      },
      writeRequest: true,
    };

    expect(renderPlanText(walkthroughReport({ actions: [slot], diagnostics: [] }))).toContain(
      "  - issueType      (unused default)",
    );
  });

  it("前後が同じ項目は変更行に現れない", () => {
    expect(renderPlanText(walkthroughReport())).not.toContain("color: ");
  });

  it("Webhook のイベントは数値に名前を添えて描かれる", () => {
    const update: Action = {
      id: "webhooks/update/Slack 通知",
      phase: 8,
      kind: "webhook",
      op: "update",
      name: "Slack 通知",
      target: 55,
      changes: [{ field: "events", before: [1, 2], after: [1, 2, 3] }],
      request: {
        method: "PATCH",
        path: "/api/v2/projects/PROJ_A/webhooks/55",
        params: { activityTypeIds: [1, 2, 3] },
      },
      writeRequest: true,
    };

    expect(renderPlanText(walkthroughReport({ actions: [update], diagnostics: [] }))).toContain(
      "      events: 1 (Issue Created), 2 (Issue Updated) -> 1 (Issue Created), 2 (Issue Updated), 3 (Issue Commented)",
    );
  });

  it("環境変数由来の値は伏せられ、利用者が付けた名前はそのまま出る", () => {
    const text = renderPlanText(walkthroughReport());

    expect(text).toContain('"Slack 通知"  hookUrl ***');
    expect(text).not.toContain("hooks.example.com");
  });

  it("これから作られるリソースへの参照は、偽の ID ではなく名前で描かれる", () => {
    const update: Action = {
      id: "customFields/update/影響範囲",
      phase: 6,
      kind: "customField",
      op: "update",
      name: "影響範囲",
      target: 31,
      changes: [
        {
          field: "applicableIssueTypes",
          before: null,
          after: [{ $ref: { kind: "issueType", name: "バグ" } }],
        },
      ],
      request: { method: "PATCH", path: "/api/v2/projects/PROJ_A/customFields/31", params: {} },
      writeRequest: true,
    };

    expect(renderPlanText(walkthroughReport({ actions: [update], diagnostics: [] }))).toContain(
      '      applicableIssueTypes: (none) -> <issueType "バグ" (to be created)>',
    );
  });

  it("更新系が1件も無いときは本体を出さず1行で伝える", () => {
    const report = walkthroughReport({
      project: { key: "PROJ_A", name: "プロジェクトA", exists: true },
      actions: walkthroughActions().filter(({ op }) => op === "noop"),
      diagnostics: [],
    });

    expect(renderPlanText(report)).toBe(
      `Blueprint: PROJ_A (example.backlog.com)
No changes. The project already matches the manifest.
`,
    );
  });

  it("60 秒以上の見積もりは分と秒で表す", () => {
    const many = Array.from({ length: 150 }, (_unused, index): Action => ({
      id: `categories/create/${index}`,
      phase: 4,
      kind: "category",
      op: "create",
      name: String(index),
      request: {
        method: "POST",
        path: "/api/v2/projects/PROJ_A/categories",
        params: { name: String(index) },
      },
      writeRequest: true,
    }));

    expect(renderPlanText(walkthroughReport({ actions: many, diagnostics: [] }))).toContain(
      "Write requests: 150 (estimated 2m 30s)",
    );
  });

  it("色は呼び出し側が有効にしたときだけ付く", () => {
    const report = walkthroughReport({ actions: [actionOf("issueTypes/delete/要望")] });

    expect(renderPlanText(report, { color: true })).toContain(
      `${ESCAPE}[31m- issueType      "要望"${ESCAPE}[0m`,
    );
    expect(renderPlanText(report)).not.toContain(ESCAPE);
  });
});

describe("apply の人間向け出力", () => {
  it("確認プロンプトは yes の全文入力を求める", () => {
    expect(APPLY_CONFIRMATION).toBe(
      `Do you want to apply these changes?
  Only "yes" will be accepted to confirm.

  Enter a value: `,
    );
  });

  it("進捗は 0 始まりの添字を 1 始まりの件数として描く", () => {
    const total = executed().length;

    expect(renderProgress({ index: 0, total, action: actionOf("project/create/PROJ_A") })).toBe(
      "[ 1/10] + project        PROJ_A ...",
    );
    expect(
      renderProgress({ index: 1, total, action: actionOf("project/refresh"), outcome: "done" }),
    ).toBe("[ 2/10] ↻ refresh        reading back default issue types and statuses ... done");
  });

  it("完了の行は追加・変更・削除の件数を伝える", () => {
    expect(renderApplyComplete(executed())).toBe(
      "Apply complete. 5 added, 3 changed, 1 destroyed.",
    );
  });

  it("中断レポートは失敗したリクエストと3つの一覧、再開の条件を伝える", () => {
    const actions = executed();
    const failedIndex = actions.findIndex(({ id }) => id === "issueTypes/delete/要望");
    const resolutions: ResolutionTable = new Map([["issueType:要望", 1234]]);

    expect(
      renderApplyAbort(
        {
          result: "aborted",
          applied: actions.slice(0, failedIndex),
          failed: {
            action: actions[failedIndex] as Action,
            status: 400,
            errors: [
              { message: "deletedTargetIssueTypeId and substituteIssueTypeId are the same." },
            ],
          },
          pending: actions.slice(failedIndex + 1),
        },
        { resolutions },
      ),
    ).toBe(
      `ERROR  DELETE /api/v2/projects/PROJ_A/issueTypes/1234
  400  deletedTargetIssueTypeId and substituteIssueTypeId are the same.

Apply aborted. Nothing has been rolled back.

Applied (4):
  + project        PROJ_A
  ↻ refresh
  ~ issueType      "バグ"
  ~ issueType      "調査"
Failed (1):
  - issueType      "要望"
Not applied (5):
  + status         "レビュー中"
  ~ statusOrder    未対応, 処理中, レビュー中, 処理済み, 完了
  + projectTeam    "開発チーム"
  + projectMember  "suzuki"
  + webhook        "Slack 通知"

Re-run apply with the same manifest to continue. Already applied changes become no-ops.
The project must still have zero issues at that point.
`,
    );
  });

  it("HTTP まで到達しなかった失敗にはステータスを添えない", () => {
    const action: Action = {
      id: "webhooks/create/Slack 通知",
      phase: 8,
      kind: "webhook",
      op: "create",
      name: "Slack 通知",
      request: {
        method: "POST",
        path: "/api/v2/projects/PROJ_A/webhooks",
        params: { hookUrl: new Secret("https://hooks.example.com/T000/B000") },
      },
      writeRequest: true,
    };

    expect(
      renderApplyAbort({
        result: "aborted",
        applied: [],
        failed: { action, errors: [{ message: "network error" }] },
        pending: [],
      }),
    ).toContain(
      `ERROR  POST /api/v2/projects/PROJ_A/webhooks
  network error`,
    );
  });
});

describe("適用の結末", () => {
  it("成功したら追加・変更・削除の件数を書く", () => {
    expect(renderApplyResult({ result: "succeeded", applied: executed() })).toBe(
      "Apply complete. 5 added, 3 changed, 1 destroyed.\n",
    );
  });

  it("確認を拒否したら、何も適用していないことを書く", () => {
    expect(renderApplyResult({ result: "rejected" })).toBe(
      "Apply cancelled. Nothing has been applied.\n",
    );
  });

  it("中断したら、適用済み・失敗・未適用の3つを書く", () => {
    const text = renderApplyResult({
      result: "aborted",
      applied: [],
      failed: {
        action: actionOf("issueTypes/delete/要望"),
        status: 400,
        errors: [{ message: "bad" }],
      },
      pending: [],
    });

    expect(text).toContain("Apply aborted. Nothing has been rolled back.");
    expect(text).toContain("Failed (1):");
  });
});

describe("送信層が投げた失敗", () => {
  it("ステータスと本文だけを書く", () => {
    expect(renderHttpFailure({ status: 401, errors: [{ message: "Unauthorized." }] })).toBe(
      "ERROR  401  Unauthorized.\n",
    );
  });

  it("HTTP まで到達しなかった失敗にはステータスを添えない", () => {
    expect(renderHttpFailure({ errors: [{ message: "network error" }] })).toBe(
      "ERROR  network error\n",
    );
  });

  it("HttpFailure ではないものを投げられても読めたところまでで書く", () => {
    expect(renderHttpFailure(new TypeError("boom"))).toBe("ERROR  boom\n");
  });
});
