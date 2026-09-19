import { describe, expect, it } from "vitest";

import {
  fixedPlanContext,
  fixedReadContext,
  fixedSnapshot,
  secretPaths,
} from "../../../test-utils/src/index";
import { Secret } from "../secret";
import { type IssueType } from "../manifest";
import { DEFAULT_ISSUE_TYPES, issueTypesReconciler, type ExistingIssueType } from "./issue-types";

const plan = (desired: IssueType[], snapshot: ExistingIssueType[]) =>
  issueTypesReconciler.plan(desired, snapshot, fixedPlanContext());

const task: ExistingIssueType = { id: 11, name: "タスク", color: "#7ea800" };
const other: ExistingIssueType = { id: 14, name: "その他", color: "#2779ca" };

describe("現状の取得", () => {
  it("未作成のプロジェクトでは既定4件が現状になり、ID は持たない", async () => {
    const snapshot = await issueTypesReconciler.read(
      fixedReadContext({}, { snapshot: fixedSnapshot({ project: { exists: false } }) }),
    );

    expect(snapshot).toEqual(DEFAULT_ISSUE_TYPES);
    expect(snapshot.every(({ id }) => id === undefined)).toBe(true);
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

    expect(snapshot).toEqual([
      {
        id: 11,
        name: "タスク",
        color: "#7ea800",
        templateSummary: undefined,
        templateDescription: undefined,
      },
    ]);
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

  it("違う項目だけが前後差分として並ぶ", () => {
    const actions = plan(
      [{ name: "バグ", color: "#990000", templateSummary: "【不具合】" }],
      [{ id: 12, name: "バグ", color: "#990000" }],
    );

    expect(actions[0]?.changes).toEqual([
      { field: "templateSummary", before: null, after: "【不具合】" },
    ]);
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
  it("既定の課題種別は ID が分からないので、path も振替先も参照のまま計画する", () => {
    const actions = plan([{ name: "調査", color: "#2779ca" }], DEFAULT_ISSUE_TYPES);

    expect(actions.at(-1)).toMatchObject({
      name: "その他",
      op: "delete",
      target: { $ref: { kind: "issueType", name: "その他" } },
      request: {
        path: "/api/v2/projects/PROJ_A/issueTypes/{$ref:issueType:その他}",
        params: { substituteIssueTypeId: { $ref: { kind: "issueType", name: "調査" } } },
      },
    });
  });
});

describe("環境変数から展開した値", () => {
  it("課題テンプレートが ${ENV} 由来なら計画に実値が現れない", () => {
    const actions = issueTypesReconciler.plan(
      [{ name: "バグ", color: "#990000", templateDescription: "社外秘の手順" }],
      [],
      fixedPlanContext({ isSecret: secretPaths("issueTypes/0/templateDescription") }),
    );

    expect(actions[0]?.request?.params.templateDescription).toBeInstanceOf(Secret);
    expect(JSON.stringify(actions)).not.toContain("社外秘の手順");
  });
});
