import { describe, expect, it } from "vitest";

import { type Action } from "../action";
import { type ResolutionTable } from "../resolution";
import { walkthroughActions, walkthroughReport, walkthroughValidateReport } from "./fixtures";
import {
  applyJson,
  planJson,
  renderApplyJson,
  renderPlanJson,
  renderValidateJson,
  validateJson,
} from "./json";

const actionOf = (id: string): Action => {
  const action = walkthroughActions().find((candidate) => candidate.id === id);

  if (action === undefined) {
    throw new Error(`No fixture action ${id}`);
  }

  return action;
};

const executed = (): Action[] => walkthroughActions().filter(({ op }) => op !== "noop");

const parsed = (text: string): Record<string, unknown> =>
  JSON.parse(text) as Record<string, unknown>;

describe("validate の機械向け出力", () => {
  it("形式の版・ツール・マニフェスト・診断だけを持つ", () => {
    expect(Object.keys(validateJson(walkthroughValidateReport()))).toEqual([
      "formatVersion",
      "tool",
      "manifest",
      "diagnostics",
    ]);
  });

  it("スペースとプロジェクトを持たない", () => {
    const json = validateJson(walkthroughValidateReport());

    expect(json).not.toHaveProperty("space");
    expect(json).not.toHaveProperty("project");
  });

  it("計画に関わる項目を持たない", () => {
    const json = validateJson(walkthroughValidateReport());

    expect(json).not.toHaveProperty("summary");
    expect(json).not.toHaveProperty("actions");
    expect(json).not.toHaveProperty("resultingOrder");
  });

  it("診断はステージ順に並ぶ", () => {
    const json = validateJson(
      walkthroughValidateReport({
        diagnostics: [
          { id: "V-A5", severity: "error", stage: "semantic", path: "issueTypes", message: "dup" },
          { id: "V-A23", severity: "error", stage: "syntax", path: "", message: "broken" },
        ],
      }),
    );

    expect(json.diagnostics.map(({ id }) => id)).toEqual(["V-A23", "V-A5"]);
  });

  it("改行で終わる JSON を書き出す", () => {
    const text = renderValidateJson(walkthroughValidateReport());

    expect(text.endsWith("\n")).toBe(true);
    expect(parsed(text)["formatVersion"]).toBe(1);
  });
});

describe("plan の機械向け出力", () => {
  it("スペース・マニフェスト・プロジェクト・集計・診断・Action・適用後の並びを持つ", () => {
    expect(Object.keys(planJson(walkthroughReport()))).toEqual([
      "formatVersion",
      "tool",
      "space",
      "manifest",
      "project",
      "summary",
      "diagnostics",
      "actions",
      "resultingOrder",
    ]);
  });

  it("形式の版は整数で持つ", () => {
    expect(planJson(walkthroughReport()).formatVersion).toBe(1);
  });

  it("集計は更新系の件数と見積もり秒数を持つ", () => {
    expect(planJson(walkthroughReport()).summary).toEqual({
      hasChanges: true,
      create: 5,
      update: 2,
      delete: 1,
      reorder: 1,
      noop: 5,
      writeRequests: 9,
      estimatedSeconds: 9,
    });
  });

  it("一致しているリソースの Action も含める", () => {
    expect(planJson(walkthroughReport()).actions.map(({ id }) => id)).toContain(
      "issueTypes/noop/タスク",
    );
  });

  it("変わらない項目も含めた全フィールドを差分として持つ", () => {
    const action = planJson(walkthroughReport()).actions.find(
      ({ id }) => id === "issueTypes/update/調査",
    );

    expect(action?.changes).toEqual([
      { field: "name", before: "その他", after: "調査" },
      { field: "color", before: "#2779ca", after: "#2779ca" },
    ]);
  });

  it("実際に飛ぶリクエストを含め、環境変数由来の値は伏せる", () => {
    const webhook = parsed(renderPlanJson(walkthroughReport()));
    const actions = webhook["actions"] as { id: string; request?: { params: unknown } }[];
    const created = actions.find(({ id }) => id === "webhooks/create/Slack 通知");

    expect(created?.request?.params).toEqual({
      name: "Slack 通知",
      hookUrl: "***",
      allEvent: false,
      activityTypeIds: [1, 2],
    });
  });

  it("未解決の参照は偽の ID で埋めずそのまま出す", () => {
    const document = parsed(renderPlanJson(walkthroughReport()));
    const actions = document["actions"] as { id: string; target?: unknown }[];

    expect(actions.find(({ id }) => id === "issueTypes/update/調査")?.target).toEqual({
      $ref: { kind: "issueType", name: "その他" },
    });
  });
});

describe("apply の機械向け出力", () => {
  it("実行が終わってから最終結果を1つだけ出す", () => {
    const text = renderApplyJson(walkthroughReport(), {
      result: "succeeded",
      applied: executed(),
    });

    expect(() => JSON.parse(text)).not.toThrow();
    expect(parsed(text)["result"]).toBe("succeeded");
  });

  it("中断した実行は適用済み・失敗・未適用を Action の識別子で並べる", () => {
    const actions = executed();
    const failedIndex = actions.findIndex(({ id }) => id === "issueTypes/delete/要望");
    const resolutions: ResolutionTable = new Map([["issueType:要望", 1234]]);

    const document = applyJson(
      walkthroughReport(),
      {
        result: "aborted",
        applied: actions.slice(0, failedIndex),
        failed: {
          action: actionOf("issueTypes/delete/要望"),
          status: 400,
          errors: [{ message: "deletedTargetIssueTypeId and substituteIssueTypeId are the same." }],
        },
        pending: actions.slice(failedIndex + 1),
      },
      { resolutions },
    );

    expect(document.applied).toEqual([
      "project/create/PROJ_A",
      "project/refresh",
      "issueTypes/update/バグ",
      "issueTypes/update/調査",
    ]);
    expect(document.failed).toEqual({
      id: "issueTypes/delete/要望",
      request: { method: "DELETE", path: "/api/v2/projects/PROJ_A/issueTypes/1234" },
      status: 400,
      errors: [{ message: "deletedTargetIssueTypeId and substituteIssueTypeId are the same." }],
    });
    expect(document.pending).toEqual([
      "statuses/create/レビュー中",
      "statuses/reorder",
      "projectTeams/create/開発チーム",
      "projectMembers/create/suzuki",
      "webhooks/create/Slack 通知",
    ]);
  });

  it("Backlog に届かなかった失敗ではステータスの項目が現れない", () => {
    const text = renderApplyJson(walkthroughReport(), {
      result: "aborted",
      applied: [],
      failed: { action: actionOf("project/create/PROJ_A"), errors: [{ message: "network error" }] },
      pending: [],
    });
    const failed = parsed(text)["failed"] as Record<string, unknown>;

    expect("status" in failed).toBe(false);
    expect(failed["errors"]).toEqual([{ message: "network error" }]);
  });

  it("確認を拒否した実行では何も適用されていない", () => {
    const document = applyJson(walkthroughReport(), { result: "rejected" });

    expect(document.applied).toEqual([]);
    expect(document.failed).toBeUndefined();
    expect(document.pending).toHaveLength(executed().length);
  });
});
