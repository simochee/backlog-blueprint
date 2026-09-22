import { describe, expect, it } from "vitest";

import { fixedPlanContext, fixedReadContext, fixedSnapshot } from "../../../test-utils/src/index";
import { type Status } from "../manifest";
import {
  DEFAULT_STATUSES_EN,
  DEFAULT_STATUSES_JA,
  matchDefaultStatuses,
  statusesReconciler,
  type ExistingStatus,
} from "./statuses";

const plan = (desired: Status[], snapshot: ExistingStatus[]) =>
  statusesReconciler.plan(desired, { source: "project", statuses: snapshot }, fixedPlanContext());

const planNewProject = (desired: Status[]) =>
  statusesReconciler.plan(desired, { source: "defaults" }, fixedPlanContext());

const defaults: Status[] = [
  { name: "未対応" },
  { name: "処理中" },
  { name: "処理済み" },
  { name: "完了" },
];

const englishDefaults = DEFAULT_STATUSES_EN;

describe("現状の取得", () => {
  it("未作成のプロジェクトでは、既定4件の表示名を取得せずに枠だけを持つ", async () => {
    const snapshot = await statusesReconciler.read(
      fixedReadContext({}, { snapshot: fixedSnapshot({ project: { exists: false } }) }),
    );

    expect(snapshot).toEqual({ source: "defaults" });
  });

  it("既存プロジェクトのステータスは GET の応答から読む", async () => {
    const snapshot = await statusesReconciler.read(
      fixedReadContext({
        "/api/v2/projects/PROJ_A/statuses": [
          { id: 1, name: "未対応", color: "#ed8077", displayOrder: 1000 },
        ],
      }),
    );

    expect(snapshot).toEqual({
      source: "project",
      statuses: [{ id: 1, name: "未対応", color: "#ed8077" }],
    });
  });
});

describe("既定ステータス", () => {
  it("既定の4件には何も起きない", () => {
    const actions = plan(defaults, DEFAULT_STATUSES_JA);

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
      [...DEFAULT_STATUSES_JA, review, { id: 6, name: "確認中", color: "#eda62a" }],
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
      [...DEFAULT_STATUSES_JA, { id: 6, name: "確認中", color: "#3b9dbd" }],
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
      [...DEFAULT_STATUSES_JA, { id: 6, name: "確認中", color: "#3b9dbd" }],
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
      DEFAULT_STATUSES_JA,
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
      ...DEFAULT_STATUSES_JA,
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
    const actions = plan(defaults, DEFAULT_STATUSES_JA);
    const reorders = actions.filter(({ id }) => id === "statuses/reorder");

    expect(reorders).toHaveLength(1);
    expect(actions.at(-1)?.id).toBe("statuses/reorder");
  });

  it("新規カスタムは完了の直前に入るので、全ステータスを1リクエストで並べ直す", () => {
    const actions = plan(
      [...defaults.slice(0, 2), { name: "レビュー中", color: "#3b9dbd" }, ...defaults.slice(2)],
      DEFAULT_STATUSES_JA,
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
      DEFAULT_STATUSES_JA,
    );

    expect(actions.at(-1)).toMatchObject({
      id: "statuses/reorder",
      op: "noop",
      writeRequest: false,
    });
  });
});

describe("文字列値の出力", () => {
  it("ステータス名はマニフェストに指定するとリクエストにも差分にも平文で出る", () => {
    const [create] = statusesReconciler.plan(
      [{ name: "社外秘ステータス", color: "#3b9dbd" }],
      { source: "project", statuses: [] },
      fixedPlanContext(),
    );

    expect(create?.request?.params.name).toBe("社外秘ステータス");
    expect(create?.changes).toContainEqual({
      field: "name",
      before: null,
      after: "社外秘ステータス",
    });
    expect(create?.id).toBe("statuses/create/社外秘ステータス");
  });
});

describe("冪等性", () => {
  it("マニフェストに指定した色が現状と同じなら2回目は noop になる", () => {
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

    const actions = statusesReconciler.plan(
      desired,
      { source: "project", statuses: applied },
      fixedPlanContext(),
    );

    expect(actions.every(({ op }) => op === "noop")).toBe(true);
  });

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

describe("応答の検査", () => {
  it("ステータスの応答に色が無ければ取り込む時点で落ちる", async () => {
    await expect(
      statusesReconciler.read(
        fixedReadContext({ "/api/v2/projects/PROJ_A/statuses": [{ id: 1, name: "未対応" }] }),
      ),
    ).rejects.toThrow("color");
  });
});

describe("未作成のプロジェクトの既定ステータス", () => {
  const englishNames: Status[] = DEFAULT_STATUSES_EN.map(({ name }) => ({ name }));

  it("日本語の既定名で書けば、既定4件には何も起きない", () => {
    const actions = planNewProject(defaults);

    expect(actions.every(({ op }) => op === "noop")).toBe(true);
  });

  it("英語の既定名で書いても、既定4件には何も起きない", () => {
    const actions = planNewProject(englishNames);

    expect(actions.every(({ op }) => op === "noop")).toBe(true);
  });

  it("英語の既定名は ID 1〜4 の既定として引き当てられる", () => {
    const actions = planNewProject(englishNames);

    expect(actions.filter(({ op }) => op === "noop").map(({ target }) => target)).toEqual([
      1,
      2,
      3,
      4,
      undefined,
    ]);
  });

  it("英語の既定名に足したカスタムだけが作成される", () => {
    const actions = planNewProject([
      ...englishNames.slice(0, 3),
      { name: "In Review", color: "#3b9dbd" },
      ...englishNames.slice(3),
    ]);

    expect(actions.filter(({ op }) => op === "create").map(({ name }) => name)).toEqual([
      "In Review",
    ]);
  });

  it("どちらかの組の既定名がすべて揃っていれば既定として扱う", () => {
    expect(matchDefaultStatuses(defaults.map(({ name }) => name))).toEqual(DEFAULT_STATUSES_JA);
    expect(matchDefaultStatuses(englishNames.map(({ name }) => name))).toEqual(DEFAULT_STATUSES_EN);
  });

  it("2つの組を混ぜて書いたマニフェストはどちらの組にも一致しない", () => {
    expect(matchDefaultStatuses(["未対応", "In Progress", "処理済み", "Closed"])).toBeUndefined();
  });
});
