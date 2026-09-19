import { describe, expect, it } from "vitest";

import { fixedPlanContext, fixedReadContext, fixedSnapshot } from "../../../test-utils/src/index";
import { type Status } from "../manifest";
import { DEFAULT_STATUSES, statusesReconciler, type ExistingStatus } from "./statuses";

const plan = (desired: Status[], snapshot: ExistingStatus[]) =>
  statusesReconciler.plan(desired, snapshot, fixedPlanContext());

const defaults: Status[] = [
  { name: "未対応" },
  { name: "処理中" },
  { name: "処理済み" },
  { name: "完了" },
];

const englishDefaults: ExistingStatus[] = [
  { id: 1, name: "Open", color: "#ed8077" },
  { id: 2, name: "In Progress", color: "#4488c5" },
  { id: 3, name: "Resolved", color: "#5eb5a6" },
  { id: 4, name: "Closed", color: "#b0be3c" },
];

describe("現状の取得", () => {
  it("未作成のプロジェクトでも既定4件の ID は 1〜4 で分かっている", async () => {
    const snapshot = await statusesReconciler.read(
      fixedReadContext({}, { snapshot: fixedSnapshot({ project: { exists: false } }) }),
    );

    expect(snapshot.map(({ id }) => id)).toEqual([1, 2, 3, 4]);
    expect(snapshot).toEqual(DEFAULT_STATUSES);
  });

  it("既存プロジェクトのステータスは GET の応答から読む", async () => {
    const snapshot = await statusesReconciler.read(
      fixedReadContext({
        "/api/v2/projects/PROJ_A/statuses": [
          { id: 1, name: "未対応", color: "#ed8077", displayOrder: 1000 },
        ],
      }),
    );

    expect(snapshot).toEqual([{ id: 1, name: "未対応", color: "#ed8077" }]);
  });
});

describe("既定ステータス", () => {
  it("既定の4件には何も起きない", () => {
    const actions = plan(defaults, DEFAULT_STATUSES);

    expect(actions.every(({ writeRequest }) => writeRequest === false)).toBe(true);
  });

  it("表示名が英語のスペースでも既定かどうかの判定は変わらない", () => {
    const actions = plan(
      [{ name: "Open" }, { name: "In Progress" }, { name: "Resolved" }, { name: "Closed" }],
      englishDefaults,
    );

    expect(actions.every(({ op }) => op === "noop")).toBe(true);
  });

  it("既定の名前を持つカスタムステータスは ID が 1〜4 でないのでカスタムとして扱う", () => {
    const actions = plan(
      [
        { name: "Open" },
        { name: "In Progress" },
        { name: "未対応", color: "#3b9dbd" },
        { name: "Resolved" },
        { name: "Closed" },
      ],
      [...englishDefaults, { id: 5, name: "未対応", color: "#ea2c00" }],
    );

    expect(actions.find(({ name }) => name === "未対応")).toMatchObject({
      op: "update",
      target: 5,
      request: { method: "PATCH", path: "/api/v2/projects/PROJ_A/statuses/5" },
      changes: [
        { field: "name", before: "未対応", after: "未対応" },
        { field: "color", before: "#ea2c00", after: "#3b9dbd" },
      ],
    });
  });
});

describe("oldname の解釈", () => {
  const review: ExistingStatus = { id: 5, name: "レビュー中", color: "#3b9dbd" };

  it("name と同名が存在するなら oldname の対象が残っていても改名しない", () => {
    const actions = plan(
      [
        ...defaults.slice(0, 3),
        { name: "レビュー中", color: "#3b9dbd", oldname: "確認中" },
        ...defaults.slice(3),
      ],
      [...DEFAULT_STATUSES, review, { id: 6, name: "確認中", color: "#eda62a" }],
    );

    expect(actions.find(({ name }) => name === "レビュー中")).toMatchObject({ op: "noop" });
    expect(actions.find(({ name }) => name === "確認中")).toMatchObject({ op: "delete" });
  });

  it("name が無く oldname と同名が存在するなら改名する", () => {
    const actions = plan(
      [
        ...defaults.slice(0, 3),
        { name: "レビュー中", color: "#3b9dbd", oldname: "確認中" },
        ...defaults.slice(3),
      ],
      [...DEFAULT_STATUSES, { id: 6, name: "確認中", color: "#3b9dbd" }],
    );

    expect(actions.find(({ name }) => name === "レビュー中")).toMatchObject({
      op: "update",
      target: 6,
      notes: [{ type: "renamed", from: "確認中" }],
      request: { params: { name: "レビュー中", color: "#3b9dbd" } },
    });
  });

  it("改名で得た ID は新しい名前で解決表に登録される", () => {
    const actions = plan(
      [
        ...defaults.slice(0, 3),
        { name: "レビュー中", color: "#3b9dbd", oldname: "確認中" },
        ...defaults.slice(3),
      ],
      [...DEFAULT_STATUSES, { id: 6, name: "確認中", color: "#3b9dbd" }],
    );

    expect(actions.find(({ name }) => name === "レビュー中")?.provides).toEqual([
      { kind: "status", name: "レビュー中" },
    ]);
  });

  it("どちらも存在しなければ作成する", () => {
    const actions = plan(
      [
        ...defaults.slice(0, 3),
        { name: "レビュー中", color: "#3b9dbd", oldname: "確認中" },
        ...defaults.slice(3),
      ],
      DEFAULT_STATUSES,
    );

    expect(actions[0]).toMatchObject({
      id: "statuses/create/レビュー中",
      op: "create",
      provides: [{ kind: "status", name: "レビュー中" }],
      request: {
        method: "POST",
        path: "/api/v2/projects/PROJ_A/statuses",
        params: { name: "レビュー中", color: "#3b9dbd" },
      },
    });
  });
});

describe("削除", () => {
  it("定義に無いカスタムは未対応へ振り替えて削除する", () => {
    const actions = plan(defaults, [
      ...DEFAULT_STATUSES,
      { id: 5, name: "レビュー中", color: "#3b9dbd" },
    ]);

    expect(actions.find(({ op }) => op === "delete")).toMatchObject({
      id: "statuses/delete/レビュー中",
      target: 5,
      request: {
        method: "DELETE",
        path: "/api/v2/projects/PROJ_A/statuses/5",
        params: { substituteStatusId: 1 },
      },
    });
  });
});

describe("表示順", () => {
  it("計画には必ず表示順の Action が1件だけ、最後に並ぶ", () => {
    const actions = plan(defaults, DEFAULT_STATUSES);
    const reorders = actions.filter(({ id }) => id === "statuses/reorder");

    expect(reorders).toHaveLength(1);
    expect(actions.at(-1)?.id).toBe("statuses/reorder");
  });

  it("新規カスタムは完了の直前に入るので、全ステータスを1リクエストで並べ直す", () => {
    const actions = plan(
      [...defaults.slice(0, 2), { name: "レビュー中", color: "#3b9dbd" }, ...defaults.slice(2)],
      DEFAULT_STATUSES,
    );

    expect(actions.at(-1)).toMatchObject({
      op: "reorder",
      writeRequest: true,
      request: {
        method: "PATCH",
        path: "/api/v2/projects/PROJ_A/statuses/updateDisplayOrder",
        params: {
          statusId: [1, 2, { $ref: { kind: "status", name: "レビュー中" } }, 3, 4],
        },
      },
      changes: [
        {
          field: "displayOrder",
          before: ["未対応", "処理中", "処理済み", "レビュー中", "完了"],
          after: ["未対応", "処理中", "レビュー中", "処理済み", "完了"],
        },
      ],
    });
  });

  it("挿入位置が記述順と同じなら並べ直さない", () => {
    const actions = plan(
      [...defaults.slice(0, 3), { name: "レビュー中", color: "#3b9dbd" }, ...defaults.slice(3)],
      DEFAULT_STATUSES,
    );

    expect(actions.at(-1)).toMatchObject({
      id: "statuses/reorder",
      op: "noop",
      writeRequest: false,
    });
  });
});

describe("冪等性", () => {
  it("適用後の現状に同じマニフェストを当てると、並べ直しも含めて何も起きない", () => {
    const desired: Status[] = [
      ...defaults.slice(0, 2),
      { name: "レビュー中", color: "#3b9dbd" },
      ...defaults.slice(2),
    ];
    const applied = [
      { id: 1, name: "未対応", color: "#ed8077" },
      { id: 2, name: "処理中", color: "#4488c5" },
      { id: 5, name: "レビュー中", color: "#3b9dbd" },
      { id: 3, name: "処理済み", color: "#5eb5a6" },
      { id: 4, name: "完了", color: "#b0be3c" },
    ];

    expect(plan(desired, applied).every(({ op }) => op === "noop")).toBe(true);
  });
});

describe("送るものと前後差分の対応（PO-11）", () => {
  it("作成でもリクエストに載る項目がすべて前後差分に並ぶ", () => {
    const [create] = plan([{ name: "レビュー中", color: "#3b9dbd" }], []);

    expect(create?.changes).toEqual([
      { field: "name", before: null, after: "レビュー中" },
      { field: "color", before: null, after: "#3b9dbd" },
    ]);
    expect(create?.changes?.map(({ field }) => field)).toEqual(
      Object.keys(create?.request?.params ?? {}),
    );
  });
});
