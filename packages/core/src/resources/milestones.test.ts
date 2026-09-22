import { describe, expect, it } from "vitest";

import { fixedPlanContext, fixedReadContext, fixedSnapshot } from "../../../test-utils/src/index";
import { type Milestone } from "../manifest";
import { milestonesReconciler, type MilestonesSnapshot } from "./milestones";

const plan = (desired: Milestone[], snapshot: MilestonesSnapshot) =>
  milestonesReconciler.plan(desired, snapshot, fixedPlanContext());

describe("マイルストーンの現状取得", () => {
  it("マイルストーンは versions から取得する", async () => {
    const snapshot = await milestonesReconciler.read(
      fixedReadContext({
        "/api/v2/projects/PROJ_A/versions": [
          {
            id: 21,
            name: "v1.0",
            description: "最初のリリース",
            startDate: "2026-10-01",
            releaseDueDate: "2026-10-31",
          },
        ],
      }),
    );

    expect(snapshot).toEqual([
      {
        id: 21,
        name: "v1.0",
        description: "最初のリリース",
        startDate: "2026-10-01",
        releaseDueDate: "2026-10-31",
      },
    ]);
  });

  it("時刻付きで返る日付は yyyy-MM-dd として扱う", async () => {
    const snapshot = await milestonesReconciler.read(
      fixedReadContext({
        "/api/v2/projects/PROJ_A/versions": [
          { id: 21, name: "v1.0", startDate: "2026-10-01T00:00:00Z" },
        ],
      }),
    );

    expect(snapshot[0]?.startDate).toBe("2026-10-01");
  });

  it("プロジェクトが未作成なら取得を行わず、空のスナップショットになる", async () => {
    const snapshot = await milestonesReconciler.read(
      fixedReadContext({}, { snapshot: fixedSnapshot({ project: { exists: false } }) }),
    );

    expect(snapshot).toEqual([]);
  });
});

describe("マイルストーンの差分", () => {
  it("日付は yyyy-MM-dd の文字列のまま送られる", () => {
    expect(
      plan(
        [
          {
            name: "v1.0",
            description: "最初のリリース",
            startDate: "2026-10-01",
            releaseDueDate: "2026-10-31",
          },
        ],
        [],
      ),
    ).toEqual([
      {
        id: "milestones/create/v1.0",
        phase: 5,
        kind: "milestone",
        op: "create",
        name: "v1.0",
        request: {
          method: "POST",
          path: "/api/v2/projects/PROJ_A/versions",
          params: {
            name: "v1.0",
            description: "最初のリリース",
            startDate: "2026-10-01",
            releaseDueDate: "2026-10-31",
          },
        },
        provides: [{ kind: "milestone", name: "v1.0" }],
        changes: [
          { field: "name", before: null, after: "v1.0" },
          { field: "description", before: null, after: "最初のリリース" },
          { field: "startDate", before: null, after: "2026-10-01" },
          { field: "releaseDueDate", before: null, after: "2026-10-31" },
        ],
        writeRequest: true,
      },
    ]);
  });

  it("書かれていないキーは送信にも差分にも載らない", () => {
    const [action] = plan([{ name: "v1.0" }], []);

    expect(action?.request?.params).toEqual({ name: "v1.0" });
    expect(action?.changes).toEqual([{ field: "name", before: null, after: "v1.0" }]);
  });

  it("書かれていないキーは既存の値と突き合わせない", () => {
    const actions = plan(
      [{ name: "v1.0" }],
      [{ id: 21, name: "v1.0", description: "最初のリリース", startDate: "2026-10-01" }],
    );

    expect(actions.map(({ op }) => op)).toEqual(["noop"]);
  });

  it("日付だけが違うマイルストーンは更新される", () => {
    const actions = plan(
      [{ name: "v1.0", releaseDueDate: "2026-11-30" }],
      [{ id: 21, name: "v1.0", releaseDueDate: "2026-10-31" }],
    );

    expect(actions).toEqual([
      {
        id: "milestones/update/v1.0",
        phase: 5,
        kind: "milestone",
        op: "update",
        name: "v1.0",
        target: 21,
        request: {
          method: "PATCH",
          path: "/api/v2/projects/PROJ_A/versions/21",
          params: { name: "v1.0", releaseDueDate: "2026-11-30" },
        },
        changes: [
          { field: "name", before: "v1.0", after: "v1.0" },
          { field: "releaseDueDate", before: "2026-10-31", after: "2026-11-30" },
        ],
        writeRequest: true,
      },
    ]);
  });

  it("一致しているマイルストーンには更新リクエストを出さない", () => {
    const actions = plan(
      [{ name: "v1.0", startDate: "2026-10-01" }],
      [{ id: 21, name: "v1.0", startDate: "2026-10-01" }],
    );

    expect(actions).toEqual([
      {
        id: "milestones/noop/v1.0",
        phase: 5,
        kind: "milestone",
        op: "noop",
        name: "v1.0",
        target: 21,
        writeRequest: false,
      },
    ]);
  });

  it("マニフェストに無い既存マイルストーンは削除される", () => {
    const actions = plan([], [{ id: 21, name: "v1.0" }]);

    expect(actions.map(({ op, name, target }) => [op, name, target])).toEqual([
      ["delete", "v1.0", 21],
    ]);
  });

  it("追加・更新・削除の順に並ぶ", () => {
    const actions = plan(
      [{ name: "v2.0" }, { name: "v1.1", oldname: "v1.0" }],
      [
        { id: 21, name: "v1.0" },
        { id: 22, name: "v0.9" },
      ],
    );

    expect(actions.map(({ op, name }) => [op, name])).toEqual([
      ["create", "v2.0"],
      ["update", "v1.1"],
      ["delete", "v0.9"],
    ]);
  });
});

describe("マイルストーンの oldname", () => {
  it("oldname のマイルストーンが存在すれば改名と他フィールドの更新が1リクエストになる", () => {
    const actions = plan(
      [{ name: "v1.1", oldname: "v1.0", releaseDueDate: "2026-11-30" }],
      [{ id: 21, name: "v1.0", releaseDueDate: "2026-10-31" }],
    );

    expect(actions).toEqual([
      {
        id: "milestones/update/v1.1",
        phase: 5,
        kind: "milestone",
        op: "update",
        name: "v1.1",
        target: 21,
        request: {
          method: "PATCH",
          path: "/api/v2/projects/PROJ_A/versions/21",
          params: { name: "v1.1", releaseDueDate: "2026-11-30" },
        },
        provides: [{ kind: "milestone", name: "v1.1" }],
        changes: [
          { field: "name", before: "v1.0", after: "v1.1" },
          { field: "releaseDueDate", before: "2026-10-31", after: "2026-11-30" },
        ],
        notes: [{ type: "renamed", from: "v1.0" }],
        writeRequest: true,
      },
    ]);
  });

  it("name と同名が存在するときは oldname を見ない", () => {
    const actions = plan(
      [{ name: "v1.1", oldname: "v1.0" }],
      [
        { id: 21, name: "v1.1" },
        { id: 22, name: "v1.0" },
      ],
    );

    expect(actions.map(({ op, name }) => [op, name])).toEqual([
      ["noop", "v1.1"],
      ["delete", "v1.0"],
    ]);
  });

  it("name も oldname も存在しなければ作成になる", () => {
    expect(plan([{ name: "v1.1", oldname: "v1.0" }], []).map(({ op }) => op)).toEqual(["create"]);
  });

  it("改名を適用した後の状態にもう一度計画すると何も起きない", () => {
    const actions = plan(
      [{ name: "v1.1", oldname: "v1.0", releaseDueDate: "2026-11-30" }],
      [{ id: 21, name: "v1.1", releaseDueDate: "2026-11-30" }],
    );

    expect(actions.map(({ op }) => op)).toEqual(["noop"]);
  });
});

describe("文字列値の出力", () => {
  it("説明が マニフェストに指定すると計画に実値が現れる", () => {
    const actions = milestonesReconciler.plan(
      [{ name: "v1.0", description: "社外秘の説明" }],
      [],
      fixedPlanContext(),
    );

    expect(actions[0]?.request?.params.description).toBe("社外秘の説明");
  });

  it("マイルストーン名はマニフェストに指定するとリクエストにも差分にも平文で出る", () => {
    const actions = milestonesReconciler.plan(
      [{ name: "社外秘マイルストーン" }],
      [],
      fixedPlanContext(),
    );

    expect(actions[0]?.request?.params.name).toBe("社外秘マイルストーン");
    expect(actions[0]?.changes).toEqual([
      { field: "name", before: null, after: "社外秘マイルストーン" },
    ]);
    expect(actions[0]?.id).toBe("milestones/create/社外秘マイルストーン");
  });
});

describe("冪等性（NFR-4）", () => {
  it("マニフェストに指定した説明が現状と同じなら2回目は noop になる", () => {
    const actions = milestonesReconciler.plan(
      [{ name: "v1.0", description: "社外秘の説明" }],
      [{ id: 21, name: "v1.0", description: "社外秘の説明" }],
      fixedPlanContext(),
    );

    expect(actions.map(({ op }) => op)).toEqual(["noop"]);
  });

  it("適用後の現状に同じマニフェストを当てると全部 noop になる", () => {
    const desired: Milestone[] = [
      { name: "v1.0", description: "最初のリリース", startDate: "2026-10-01" },
      { name: "v2.0", releaseDueDate: "2026-12-31", oldname: "v1.5" },
    ];
    const applied: MilestonesSnapshot = [
      { id: 21, name: "v1.0", description: "最初のリリース", startDate: "2026-10-01" },
      { id: 22, name: "v2.0", releaseDueDate: "2026-12-31" },
    ];

    expect(plan(desired, applied).every(({ op }) => op === "noop")).toBe(true);
  });
});
