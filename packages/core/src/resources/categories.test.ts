import { describe, expect, it } from "vitest";

import { fixedPlanContext, fixedReadContext, fixedSnapshot } from "../../../test-utils/src/index";
import { type Category } from "../manifest";
import { categoriesReconciler, type CategoriesSnapshot } from "./categories";

const plan = (desired: Category[], snapshot: CategoriesSnapshot) =>
  categoriesReconciler.plan(desired, snapshot, fixedPlanContext());

describe("カテゴリーの現状取得", () => {
  it("カテゴリーは ID と名前で持つ", async () => {
    const snapshot = await categoriesReconciler.read(
      fixedReadContext({
        "/api/v2/projects/PROJ_A/categories": [
          { id: 11, name: "インフラ", displayOrder: 2147483646 },
          { id: 12, name: "フロントエンド", displayOrder: 2147483646 },
        ],
      }),
    );

    expect(snapshot).toEqual([
      { id: 11, name: "インフラ" },
      { id: 12, name: "フロントエンド" },
    ]);
  });

  it("プロジェクトが未作成なら取得を行わず、空のスナップショットになる", async () => {
    const snapshot = await categoriesReconciler.read(
      fixedReadContext({}, { snapshot: fixedSnapshot({ project: { exists: false } }) }),
    );

    expect(snapshot).toEqual([]);
  });
});

describe("カテゴリーの差分", () => {
  it("存在しないカテゴリーは末尾に追加される", () => {
    expect(plan([{ name: "インフラ" }], [])).toEqual([
      {
        id: "categories/create/インフラ",
        phase: 4,
        kind: "category",
        op: "create",
        name: "インフラ",
        request: {
          method: "POST",
          path: "/api/v2/projects/PROJ_A/categories",
          params: { name: "インフラ" },
        },
        provides: [{ kind: "category", name: "インフラ" }],
        changes: [{ field: "name", before: null, after: "インフラ" }],
        writeRequest: true,
      },
    ]);
  });

  it("マニフェストに無い既存カテゴリーは削除される", () => {
    expect(plan([], [{ id: 11, name: "インフラ" }])).toEqual([
      {
        id: "categories/delete/インフラ",
        phase: 4,
        kind: "category",
        op: "delete",
        name: "インフラ",
        target: 11,
        request: {
          method: "DELETE",
          path: "/api/v2/projects/PROJ_A/categories/11",
          params: {},
        },
        writeRequest: true,
      },
    ]);
  });

  it("一致しているカテゴリーは何もしない Action として残る", () => {
    expect(plan([{ name: "インフラ" }], [{ id: 11, name: "インフラ" }])).toEqual([
      {
        id: "categories/noop/インフラ",
        phase: 4,
        kind: "category",
        op: "noop",
        name: "インフラ",
        target: 11,
        writeRequest: false,
      },
    ]);
  });

  it("追加・更新・削除の順に並ぶ", () => {
    const actions = plan(
      [{ name: "インフラ" }, { name: "フロントエンド", oldname: "FE" }],
      [
        { id: 11, name: "FE" },
        { id: 12, name: "バックエンド" },
      ],
    );

    expect(actions.map(({ op, name }) => [op, name])).toEqual([
      ["create", "インフラ"],
      ["update", "フロントエンド"],
      ["delete", "バックエンド"],
    ]);
  });
});

describe("カテゴリーの oldname", () => {
  it("oldname のカテゴリーが存在すれば1リクエストで改名される", () => {
    expect(plan([{ name: "インフラ", oldname: "基盤" }], [{ id: 11, name: "基盤" }])).toEqual([
      {
        id: "categories/update/インフラ",
        phase: 4,
        kind: "category",
        op: "update",
        name: "インフラ",
        target: 11,
        request: {
          method: "PATCH",
          path: "/api/v2/projects/PROJ_A/categories/11",
          params: { name: "インフラ" },
        },
        provides: [{ kind: "category", name: "インフラ" }],
        changes: [{ field: "name", before: "基盤", after: "インフラ" }],
        notes: [{ type: "renamed", from: "基盤" }],
        writeRequest: true,
      },
    ]);
  });

  it("name と同名が存在するときは oldname を見ない", () => {
    const actions = plan(
      [{ name: "インフラ", oldname: "基盤" }],
      [
        { id: 11, name: "インフラ" },
        { id: 12, name: "基盤" },
      ],
    );

    expect(actions.map(({ op, name }) => [op, name])).toEqual([
      ["noop", "インフラ"],
      ["delete", "基盤"],
    ]);
  });

  it("name も oldname も存在しなければ作成になる", () => {
    const actions = plan([{ name: "インフラ", oldname: "基盤" }], []);

    expect(actions.map(({ op, name }) => [op, name])).toEqual([["create", "インフラ"]]);
  });

  it("改名を適用した後の状態にもう一度計画すると何も起きない", () => {
    const desired: Category[] = [{ name: "インフラ", oldname: "基盤" }];

    expect(plan(desired, [{ id: 11, name: "インフラ" }]).map(({ op }) => op)).toEqual(["noop"]);
  });
});

describe("冪等性（NFR-4）", () => {
  it("適用後の現状に同じマニフェストを当てると全部 noop になる", () => {
    const desired: Category[] = [
      { name: "インフラ" },
      { name: "フロントエンド", oldname: "フロント" },
    ];
    const applied: CategoriesSnapshot = [
      { id: 11, name: "インフラ" },
      { id: 12, name: "フロントエンド" },
    ];

    expect(plan(desired, applied).every(({ op }) => op === "noop")).toBe(true);
  });
});
