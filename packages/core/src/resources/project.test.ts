import { describe, expect, it } from "vitest";

import {
  fixedManifest,
  fixedPlanContext,
  fixedReadContext,
  fixedSnapshot,
  secretPaths,
} from "../../../test-utils/src/index";
import { Secret } from "../secret";
import { projectReconciler, type ProjectSnapshot } from "./project";

const missingProject = fixedSnapshot({ project: { exists: false } });

const desired = (overrides: Parameters<typeof fixedManifest>[0] = {}) => {
  const manifest = fixedManifest(overrides);

  return { key: manifest.key, name: manifest.name, settings: manifest.settings };
};

const existing = (overrides: Partial<Extract<ProjectSnapshot, { exists: true }>> = {}) =>
  ({
    exists: true,
    id: 100,
    name: "プロジェクトA",
    settings: {},
    ...overrides,
  }) satisfies ProjectSnapshot;

describe("現状の取得", () => {
  it("プロジェクトが未作成のときは GET を1件も出さない", async () => {
    const snapshot = await projectReconciler.read(
      fixedReadContext({}, { snapshot: missingProject }),
    );

    expect(snapshot).toEqual({ exists: false });
  });

  it("既存プロジェクトの基本設定は GET /projects/:key の応答から読む", async () => {
    const snapshot = await projectReconciler.read(
      fixedReadContext({
        "/api/v2/projects/PROJ_A": { id: 100, name: "プロジェクトA", useWiki: true },
      }),
    );

    expect(snapshot).toMatchObject({ exists: true, id: 100, name: "プロジェクトA" });
  });
});

describe("未作成のプロジェクト", () => {
  it("作成の直後に再取得が1件入る（RF-1）", () => {
    const actions = projectReconciler.plan(desired(), { exists: false }, fixedPlanContext());

    expect(actions.map((action) => action.id)).toEqual([
      "project/create/PROJ_A",
      "project/refresh",
    ]);
  });

  it("再取得は GET なので更新系のリクエストに数えない", () => {
    const [, refresh] = projectReconciler.plan(desired(), { exists: false }, fixedPlanContext());

    expect(refresh).toMatchObject({ op: "refresh", writeRequest: false });
    expect(refresh?.request).toBeUndefined();
  });

  it("作成した ID は解決表にプロジェクトキーで登録される", () => {
    const [create] = projectReconciler.plan(desired(), { exists: false }, fixedPlanContext());

    expect(create?.provides).toEqual([{ kind: "project", name: "PROJ_A" }]);
  });

  it("既存プロジェクトでは再取得が入らない", () => {
    const actions = projectReconciler.plan(desired(), existing(), fixedPlanContext());

    expect(actions.map((action) => action.op)).toEqual(["noop"]);
  });
});

describe("settings", () => {
  it("書かれていないキーは送らない", () => {
    const [create] = projectReconciler.plan(
      desired({ settings: { useWiki: true } }),
      { exists: false },
      fixedPlanContext(),
    );

    expect(create?.request?.params).toEqual({
      key: "PROJ_A",
      name: "プロジェクトA",
      useWiki: true,
    });
  });

  it("false と書かれたキーは省略と区別して送る", () => {
    const [create] = projectReconciler.plan(
      desired({ settings: { useWiki: false } }),
      { exists: false },
      fixedPlanContext(),
    );

    expect(create?.request?.params).toHaveProperty("useWiki", false);
  });

  it("現状が true でもマニフェストに false と書かれていれば差分になる", () => {
    const actions = projectReconciler.plan(
      desired({ settings: { useWiki: false } }),
      existing({ settings: { useWiki: true } }),
      fixedPlanContext(),
    );

    expect(actions[0]?.changes).toEqual([
      { field: "name", before: "プロジェクトA", after: "プロジェクトA" },
      { field: "useWiki", before: true, after: false },
    ]);
  });

  it("書かれていないキーは現状と違っても差分にならない", () => {
    const actions = projectReconciler.plan(
      desired(),
      existing({ settings: { useWiki: true } }),
      fixedPlanContext(),
    );

    expect(actions.map((action) => action.op)).toEqual(["noop"]);
  });

  it("差分が何項目あっても1リクエストにまとまる", () => {
    const actions = projectReconciler.plan(
      desired({
        name: "プロジェクトB",
        settings: { useWiki: true, useGit: true, textFormattingRule: "markdown" },
      }),
      existing(),
      fixedPlanContext(),
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      op: "update",
      request: {
        method: "PATCH",
        path: "/api/v2/projects/PROJ_A",
        params: {
          name: "プロジェクトB",
          useWiki: true,
          useGit: true,
          textFormattingRule: "markdown",
        },
      },
    });
  });

  it("すべて一致していれば PATCH を打たない", () => {
    const actions = projectReconciler.plan(
      desired({ settings: { useWiki: true } }),
      existing({ settings: { useWiki: true } }),
      fixedPlanContext(),
    );

    expect(actions[0]).toMatchObject({ op: "noop", writeRequest: false });
    expect(actions[0]?.request).toBeUndefined();
  });
});

describe("環境変数から展開した値", () => {
  it("プロジェクト名が ${ENV} 由来なら計画に実値が現れない", () => {
    const actions = projectReconciler.plan(
      desired({ name: "極秘プロジェクト" }),
      { exists: false },
      fixedPlanContext({ isSecret: secretPaths("name") }),
    );

    expect(actions[0]?.request?.params.name).toBeInstanceOf(Secret);
    expect(JSON.stringify(actions)).not.toContain("極秘プロジェクト");
  });

  it("基本設定の値が ${ENV} 由来ならその値だけが包まれる", () => {
    const actions = projectReconciler.plan(
      desired({ name: "プロジェクトA", settings: { textFormattingRule: "markdown" } }),
      existing(),
      fixedPlanContext({ isSecret: secretPaths("settings/textFormattingRule") }),
    );

    expect(actions[0]?.request?.params.textFormattingRule).toBeInstanceOf(Secret);
    expect(actions[0]?.request?.params.name).toBe("プロジェクトA");
  });
});

describe("送るものと前後差分の対応（PO-11）", () => {
  it("作成でもリクエストに載る項目がすべて前後差分に並ぶ", () => {
    const [create] = projectReconciler.plan(
      desired({ settings: { useWiki: true } }),
      { exists: false },
      fixedPlanContext(),
    );

    expect(create?.changes).toEqual([
      { field: "key", before: null, after: "PROJ_A" },
      { field: "name", before: null, after: "プロジェクトA" },
      { field: "useWiki", before: null, after: true },
    ]);
  });

  it("前後差分の項目名はリクエストのキー名と一致する", () => {
    const [update] = projectReconciler.plan(
      desired({ settings: { useWiki: true, chartEnabled: false } }),
      existing({ settings: { useWiki: false } }),
      fixedPlanContext(),
    );

    expect(update?.changes?.map(({ field }) => field)).toEqual(
      Object.keys(update?.request?.params ?? {}),
    );
  });
});

describe("冪等性（NFR-4）", () => {
  it("${ENV} 由来のプロジェクト名が現状と同じなら2回目は何も起きない", () => {
    const actions = projectReconciler.plan(
      desired({ name: "極秘プロジェクト" }),
      existing({ name: "極秘プロジェクト" }),
      fixedPlanContext({ isSecret: secretPaths("name") }),
    );

    expect(actions.map(({ op }) => op)).toEqual(["noop"]);
  });

  it("${ENV} 由来の基本設定が現状と同じなら2回目は何も起きない", () => {
    const actions = projectReconciler.plan(
      desired({ settings: { textFormattingRule: "markdown" } }),
      existing({ settings: { textFormattingRule: "markdown" } }),
      fixedPlanContext({ isSecret: secretPaths("settings/textFormattingRule") }),
    );

    expect(actions.map(({ op }) => op)).toEqual(["noop"]);
  });

  it("適用後の現状に同じマニフェストを当てると何も起きない", () => {
    const settings = {
      textFormattingRule: "markdown" as const,
      chartEnabled: true,
      useWiki: false,
      subtaskingEnabled: true,
    };
    const applied = existing({ name: "プロジェクトB", settings });

    const actions = projectReconciler.plan(
      desired({ name: "プロジェクトB", settings }),
      applied,
      fixedPlanContext(),
    );

    expect(actions.every(({ op }) => op === "noop")).toBe(true);
  });
});
