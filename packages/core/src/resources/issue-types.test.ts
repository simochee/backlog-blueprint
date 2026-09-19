import { describe, expect, it } from "vitest";

import {
  fixedPlanContext,
  fixedReadContext,
  fixedSnapshot,
  secretPaths,
} from "../../../test-utils/src/index";
import { Secret } from "../secret";
import { type IssueType } from "../manifest";
import {
  DEFAULT_ISSUE_TYPE_SLOTS,
  defaultIssueTypeSlotRefs,
  issueTypesReconciler,
  type ExistingIssueType,
} from "./issue-types";

const plan = (desired: IssueType[], snapshot: ExistingIssueType[]) =>
  issueTypesReconciler.plan(
    desired,
    { source: "project", issueTypes: snapshot },
    fixedPlanContext(),
  );

const planNewProject = (desired: IssueType[]) =>
  issueTypesReconciler.plan(
    desired,
    { source: "defaults", slots: DEFAULT_ISSUE_TYPE_SLOTS },
    fixedPlanContext(),
  );

const task: ExistingIssueType = { id: 11, name: "タスク", color: "#7ea800" };
const other: ExistingIssueType = { id: 14, name: "その他", color: "#2779ca" };

describe("現状の取得", () => {
  it("未作成のプロジェクトでは既定4件を名前の無い枠として持つ", async () => {
    const snapshot = await issueTypesReconciler.read(
      fixedReadContext({}, { snapshot: fixedSnapshot({ project: { exists: false } }) }),
    );

    expect(snapshot).toEqual({ source: "defaults", slots: 4 });
  });

  it("既存プロジェクトの課題種別は GET の応答から読み、テンプレート未設定は未設定のまま扱う", async () => {
    const snapshot = await issueTypesReconciler.read(
      fixedReadContext({
        "/api/v2/projects/PROJ_A/issueTypes": [
          {
            id: 11,
            name: "タスク",
            color: "#7ea800",
            templateSummary: null,
            templateDescription: null,
          },
        ],
      }),
    );

    expect(snapshot).toEqual({
      source: "project",
      issueTypes: [
        {
          id: 11,
          name: "タスク",
          color: "#7ea800",
          templateSummary: undefined,
          templateDescription: undefined,
        },
      ],
    });
  });
});

describe("oldname の解釈", () => {
  it("name と同名が存在するなら oldname の対象が残っていても改名しない", () => {
    const actions = plan([{ name: "タスク", color: "#7ea800", oldname: "その他" }], [task, other]);

    expect(actions.find(({ name }) => name === "タスク")).toMatchObject({ op: "noop" });
    expect(actions.find(({ name }) => name === "その他")).toMatchObject({ op: "delete" });
  });

  it("name が無く oldname と同名が存在するなら、改名と他フィールドを1リクエストに乗せる", () => {
    const [action] = plan(
      [{ name: "調査", color: "#2779ca", oldname: "その他", templateSummary: "【調査】" }],
      [other],
    );

    expect(action).toMatchObject({
      id: "issueTypes/update/調査",
      op: "update",
      target: 14,
      notes: [{ type: "renamed", from: "その他" }],
      request: {
        method: "PATCH",
        path: "/api/v2/projects/PROJ_A/issueTypes/14",
        params: { name: "調査", color: "#2779ca", templateSummary: "【調査】" },
      },
      writeRequest: true,
    });
  });

  it("改名で得た ID は新しい名前で解決表に登録される", () => {
    const [action] = plan([{ name: "調査", color: "#2779ca", oldname: "その他" }], [other]);

    expect(action?.provides).toEqual([{ kind: "issueType", name: "調査" }]);
  });

  it("name も oldname も存在しなければ作成する", () => {
    const [action] = plan([{ name: "調査", color: "#2779ca", oldname: "存在しない種別" }], []);

    expect(action).toMatchObject({
      id: "issueTypes/create/調査",
      op: "create",
      provides: [{ kind: "issueType", name: "調査" }],
      request: { method: "POST", path: "/api/v2/projects/PROJ_A/issueTypes" },
    });
  });

  it("改名が済んだ後に同じマニフェストを当てても何も起きない", () => {
    const renamed: IssueType = { name: "調査", color: "#2779ca", oldname: "その他" };

    const applied = [{ id: 14, name: "調査", color: "#2779ca" }];

    expect(plan([renamed], applied).map(({ op }) => op)).toEqual(["noop"]);
  });
});

describe("差分の算出", () => {
  it("名前も色もテンプレートも一致していれば PATCH を打たない", () => {
    const actions = plan([{ name: "タスク", color: "#7ea800" }], [task]);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ op: "noop", target: 11, writeRequest: false });
    expect(actions[0]?.request).toBeUndefined();
  });

  it("前後差分にはリクエストに載る項目がすべて並ぶ", () => {
    const actions = plan(
      [{ name: "バグ", color: "#990000", templateSummary: "【不具合】" }],
      [{ id: 12, name: "バグ", color: "#990000" }],
    );

    expect(actions[0]?.changes).toEqual([
      { field: "name", before: "バグ", after: "バグ" },
      { field: "color", before: "#990000", after: "#990000" },
      { field: "templateSummary", before: null, after: "【不具合】" },
    ]);
    expect(Object.keys(actions[0]?.request?.params ?? {})).toEqual(
      actions[0]?.changes?.map(({ field }) => field),
    );
  });

  it("書かれていないテンプレートは現状が残っていても差分にならない", () => {
    const actions = plan(
      [{ name: "バグ", color: "#990000" }],
      [{ id: 12, name: "バグ", color: "#990000", templateSummary: "【不具合】" }],
    );

    expect(actions.map(({ op }) => op)).toEqual(["noop"]);
  });

  it("追加・更新・削除の順に並ぶ", () => {
    const actions = plan(
      [
        { name: "タスク", color: "#7ea800" },
        { name: "調査", color: "#2779ca" },
      ],
      [task, other],
    );

    expect(actions.map(({ id }) => id)).toEqual([
      "issueTypes/create/調査",
      "issueTypes/noop/タスク",
      "issueTypes/delete/その他",
    ]);
  });
});

describe("削除", () => {
  it("振替先は定義の先頭の課題種別を名前で指す", () => {
    const actions = plan([{ name: "タスク", color: "#7ea800" }], [task, other]);

    expect(actions.at(-1)).toMatchObject({
      op: "delete",
      request: {
        method: "DELETE",
        path: "/api/v2/projects/PROJ_A/issueTypes/14",
        params: { substituteIssueTypeId: { $ref: { kind: "issueType", name: "タスク" } } },
      },
    });
  });

  it("振替先は表示用の注記には出さない", () => {
    const actions = plan([{ name: "タスク", color: "#7ea800" }], [task, other]);

    expect(actions.at(-1)?.notes).toBeUndefined();
  });
});

describe("未作成のプロジェクト", () => {
  it("既定の枠は先頭から順にマニフェストの課題種別へ割り当てられる", () => {
    const actions = planNewProject([
      { name: "調査", color: "#2779ca" },
      { name: "バグ", color: "#990000" },
    ]);

    expect(actions.slice(0, 2)).toMatchObject([
      {
        id: "issueTypes/create/調査",
        op: "create",
        target: { $ref: { kind: "issueType", name: "調査" } },
        request: {
          method: "PATCH",
          path: "/api/v2/projects/PROJ_A/issueTypes/{$ref:issueType:調査}",
          params: { name: "調査", color: "#2779ca" },
        },
        provides: [{ kind: "issueType", name: "調査" }],
      },
      {
        id: "issueTypes/create/バグ",
        op: "create",
        target: { $ref: { kind: "issueType", name: "バグ" } },
      },
    ]);
  });

  it("引き継ぐ枠は、枠の位置ではなくその要素自身の名前で指す", () => {
    const actions = planNewProject([
      { name: "#1", color: "#2779ca" },
      { name: "X", color: "#990000" },
    ]);

    expect(actions.map(({ target }) => target)).toEqual([
      { $ref: { kind: "issueType", name: "#1" } },
      { $ref: { kind: "issueType", name: "X" } },
      { $ref: { kind: "issueTypeSlot", name: "2" } },
      { $ref: { kind: "issueTypeSlot", name: "3" } },
    ]);
  });

  it("枠に与える名前は、余った枠だけが位置で、それ以外はマニフェストの記述順の名前になる", () => {
    expect(defaultIssueTypeSlotRefs([{ name: "調査", color: "#2779ca" }])).toEqual([
      { kind: "issueType", name: "調査" },
      { kind: "issueTypeSlot", name: "1" },
      { kind: "issueTypeSlot", name: "2" },
      { kind: "issueTypeSlot", name: "3" },
    ]);
  });

  it("既定の枠より多く書いても、枠に与える名前は4件で止まる", () => {
    const desired: IssueType[] = [
      { name: "A", color: "#e30000" },
      { name: "B", color: "#990000" },
      { name: "C", color: "#934981" },
      { name: "D", color: "#814fbc" },
      { name: "E", color: "#2779ca" },
    ];

    expect(defaultIssueTypeSlotRefs(desired).map(({ name }) => name)).toEqual(["A", "B", "C", "D"]);
  });

  it("枠を引き継いでも、利用者が書いていない改名は注記しない", () => {
    const [action] = planNewProject([{ name: "調査", color: "#2779ca" }]);

    expect(action?.notes).toBeUndefined();
    expect(action?.changes).toEqual([
      { field: "name", before: null, after: "調査" },
      { field: "color", before: null, after: "#2779ca" },
    ]);
  });

  it("既定の枠より多く書けば、あふれた分は POST で作成される", () => {
    const desired: IssueType[] = [
      { name: "A", color: "#e30000" },
      { name: "B", color: "#990000" },
      { name: "C", color: "#934981" },
      { name: "D", color: "#814fbc" },
      { name: "E", color: "#2779ca" },
    ];

    const actions = planNewProject(desired);

    expect(actions.map(({ op }) => op)).toEqual(["create", "create", "create", "create", "create"]);
    expect(actions.at(-1)?.request?.method).toBe("POST");
    expect(actions.at(-1)?.target).toBeUndefined();
  });

  it("既定の枠が余れば、余った枠を先頭の課題種別へ振り替えて削除する", () => {
    const actions = planNewProject([{ name: "調査", color: "#2779ca" }]);

    expect(actions.slice(1).map(({ id, op }) => [id, op])).toEqual([
      ["issueTypes/delete/slot/1", "delete"],
      ["issueTypes/delete/slot/2", "delete"],
      ["issueTypes/delete/slot/3", "delete"],
    ]);
    expect(actions.at(-1)).toMatchObject({
      target: { $ref: { kind: "issueTypeSlot", name: "3" } },
      request: {
        method: "DELETE",
        path: "/api/v2/projects/PROJ_A/issueTypes/{$ref:issueTypeSlot:3}",
        params: { substituteIssueTypeId: { $ref: { kind: "issueType", name: "調査" } } },
      },
    });
  });

  it("適用後は名前で照合されるので、同じマニフェストを当てても何も起きない", () => {
    const desired: IssueType[] = [
      { name: "調査", color: "#2779ca" },
      { name: "バグ", color: "#990000" },
    ];
    const applied: ExistingIssueType[] = [
      { id: 101, name: "調査", color: "#2779ca" },
      { id: 102, name: "バグ", color: "#990000" },
    ];

    expect(plan(desired, applied).every(({ op }) => op === "noop")).toBe(true);
  });
});

describe("環境変数から展開した値", () => {
  it("課題テンプレートが ${ENV} 由来なら計画に実値が現れない", () => {
    const actions = issueTypesReconciler.plan(
      [{ name: "バグ", color: "#990000", templateDescription: "社外秘の手順" }],
      { source: "project", issueTypes: [] },
      fixedPlanContext({ isSecret: secretPaths("issueTypes/0/templateDescription") }),
    );

    expect(actions[0]?.request?.params.templateDescription).toBeInstanceOf(Secret);
    expect(JSON.stringify(actions)).not.toContain("社外秘の手順");
  });

  it("課題種別の名前は同定名なので ${ENV} 由来でもリクエストにも差分にも平文で出る", () => {
    const actions = issueTypesReconciler.plan(
      [{ name: "社外秘の課題種別", color: "#990000" }],
      { source: "project", issueTypes: [] },
      fixedPlanContext({ isSecret: secretPaths("issueTypes/0/name") }),
    );

    expect(actions[0]?.request?.params.name).toBe("社外秘の課題種別");
    expect(actions[0]?.changes).toContainEqual({
      field: "name",
      before: null,
      after: "社外秘の課題種別",
    });
    expect(actions[0]?.id).toBe("issueTypes/create/社外秘の課題種別");
  });
});

describe("冪等性（NFR-4）", () => {
  it("適用後の現状に同じマニフェストを当てると全部 noop になる", () => {
    const desired: IssueType[] = [
      { name: "タスク", color: "#7ea800" },
      { name: "バグ", color: "#990000", templateSummary: "【不具合】" },
      { name: "調査", color: "#2779ca", oldname: "その他", templateDescription: "手順:" },
    ];
    const applied: ExistingIssueType[] = [
      { id: 11, name: "タスク", color: "#7ea800" },
      { id: 12, name: "バグ", color: "#990000", templateSummary: "【不具合】" },
      { id: 14, name: "調査", color: "#2779ca", templateDescription: "手順:" },
    ];

    expect(plan(desired, applied).every(({ op }) => op === "noop")).toBe(true);
  });
});
