import { describe, expect, it } from "vitest";

import {
  fixedGet,
  fixedManifest,
  fixedSpaceResponses,
  httpFailure,
  recordingGet,
  secretPaths,
} from "../../test-utils/src/index";
import { buildPlan, createPlan } from "./planner";
import { schemaStage } from "./validation/schema-stage";

const manifestText = (
  statuses = "未対応\n  - name: 処理中\n  - name: 処理済み\n  - name: 完了",
) => `key: PROJ_A
name: プロジェクトA
issueTypes:
  - name: タスク
    color: "#7ea800"
statuses:
  - name: ${statuses}
`;

const plan = async (responses: Record<string, unknown> = {}, text = manifestText()) => {
  const { get, requested } = recordingGet(fixedSpaceResponses(responses));
  const result = await createPlan({ text, schemaStage, get });

  return { ...result, requested, ids: result.diagnostics.map(({ id }) => id) };
};

const NOT_FOUND = httpFailure({ status: 404, errors: [{ message: "No project." }] });

describe("スナップショットを根拠にした中断（S5 / S6）", () => {
  it("既定ステータスを1つ省いたマニフェストは V-A6 で中断し、Backlog を一切変更しない", async () => {
    const {
      ids,
      plan: created,
      requested,
    } = await plan({}, manifestText("未対応\n  - name: 処理中\n  - name: 完了"));

    expect(ids).toContain("V-A6");
    expect(created).toBeUndefined();
    expect(requested.every((path) => path.startsWith("/api/v2/"))).toBe(true);
  });

  it("課題が1件あるプロジェクトは V-B3 で中断する", async () => {
    const { ids, plan: created } = await plan({
      "/api/v2/issues/count?projectId[]=100": { count: 1 },
    });

    expect(ids).toEqual(["V-B3"]);
    expect(created).toBeUndefined();
  });

  it("課題件数を確認できなかったプロジェクトも V-B3 で中断する", async () => {
    const { diagnostics, plan: created } = await plan({
      "/api/v2/issues/count?projectId[]=100": httpFailure({
        status: 403,
        errors: [{ message: "No permission." }],
      }),
    });

    expect(diagnostics).toMatchObject([{ id: "V-B3", severity: "error", stage: "snapshot" }]);
    expect(diagnostics[0]?.message).toContain("could not be confirmed");
    expect(created).toBeUndefined();
  });

  it("一般ユーザーの API キーでは V-B2 で中断する", async () => {
    const { ids, plan: created } = await plan({
      "/api/v2/users/myself": { id: 1, userId: "yamada", roleType: 2 },
    });

    expect(ids).toEqual(["V-B2"]);
    expect(created).toBeUndefined();
  });

  it("権限が無いと分かった時点でスナップショットの取得を始めない", async () => {
    const { requested } = await plan({
      "/api/v2/users/myself": { id: 1, userId: "yamada", roleType: 2 },
    });

    expect(requested).toEqual(["/api/v2/users/myself"]);
  });
});

describe("計画の組み立て", () => {
  it("Action はフェーズ順に並ぶ", async () => {
    const { plan: created } = await plan();
    const phases = created?.actions.map(({ phase }) => phase) ?? [];

    expect(phases.every((phase, index) => index === 0 || phase >= (phases[index - 1] ?? 0))).toBe(
      true,
    );
  });

  it("既存リソースの名前と ID を、plan の前に解決表へ登録する", async () => {
    const { plan: created } = await plan({
      "/api/v2/projects/PROJ_A/issueTypes": [{ id: 200, name: "タスク", color: "#7ea800" }],
    });

    expect(created?.resolutions.get("issueType:タスク")).toBe(200);
  });

  it("未作成のプロジェクトでは、作成の直後に再取得を挟む", async () => {
    const { plan: created } = await plan({ "/api/v2/projects/PROJ_A": NOT_FOUND });

    expect(created?.actions.slice(0, 2).map(({ id }) => id)).toEqual([
      "project/create/PROJ_A",
      "project/refresh",
    ]);
  });

  it("未作成のプロジェクトでは、プロジェクト配下を取得しない", async () => {
    const { requested } = await plan({ "/api/v2/projects/PROJ_A": NOT_FOUND });

    expect(requested).not.toContain("/api/v2/projects/PROJ_A/issueTypes");
  });

  it("適用後の表示順を計画と一緒に返す", async () => {
    const { plan: created } = await plan();

    expect(created?.order).toEqual({
      issueTypes: ["タスク"],
      statuses: ["未対応", "処理中", "処理済み", "完了"],
      categories: [],
      milestones: [],
      customFields: [],
    });
  });

  it("マニフェストに書かれていない既存リソースは適用後の並びから消える", async () => {
    const { plan: created } = await plan({
      "/api/v2/projects/PROJ_A/categories": [{ id: 1, name: "インフラ" }],
    });

    expect(created?.order.categories).toEqual([]);
  });

  it("警告だけなら計画を返す", async () => {
    const withCategories = `${manifestText()}categories:
  - name: フロントエンド
  - name: インフラ
`;
    const { ids, plan: created } = await plan(
      { "/api/v2/projects/PROJ_A/categories": [{ id: 1, name: "インフラ" }] },
      withCategories,
    );

    expect(ids).toEqual(["V-A15"]);
    expect(created?.order.categories).toEqual(["インフラ", "フロントエンド"]);
  });

  it("マニフェストが検証を通らなければ Backlog に問い合わせない", async () => {
    const { requested, plan: created } = await plan({}, "key: proj_a\nname: プロジェクトA\n");

    expect(requested).toEqual([]);
    expect(created).toBeUndefined();
  });
});

describe("検証済みのマニフェストからの組み立て", () => {
  const declared = {
    issueTypes: [{ name: "タスク", color: "#7ea800" as const }],
    statuses: [{ name: "未対応" }, { name: "処理中" }, { name: "処理済み" }, { name: "完了" }],
  };

  const webhook = {
    name: "Slack 通知",
    hookUrl: "https://hooks.example/T0/B0",
    events: ["issueCreated" as const],
  };

  it("S1〜S4 を済ませた呼び出し側は、マニフェストを渡して S5 から始められる", async () => {
    const { plan: created } = await buildPlan({
      manifest: fixedManifest(declared),
      get: fixedGet(fixedSpaceResponses()),
      isSecret: secretPaths(),
    });

    expect(created?.actions.map(({ id }) => id)).toContain("issueTypes/create/タスク");
  });

  it("${ENV} 由来の値は計画に平文で載らない", async () => {
    const { plan: created } = await buildPlan({
      manifest: fixedManifest({ ...declared, webhooks: [webhook] }),
      get: fixedGet(fixedSpaceResponses()),
      isSecret: secretPaths("webhooks/0/hookUrl"),
    });
    const hook = created?.actions.find(({ kind }) => kind === "webhook");

    expect(JSON.stringify(hook?.request?.params)).not.toContain("hooks.example");
  });
});
