import { describe, expect, it } from "vitest";

import {
  fixedPlanContext,
  fixedReadContext,
  fixedSnapshot,
  secretPaths,
} from "../../../test-utils/src/index";
import { Secret } from "../secret";
import { type CustomField } from "../manifest";
import { customFieldsReconciler, type CustomFieldsSnapshot } from "./custom-fields";

const plan = (desired: CustomField[], snapshot: CustomFieldsSnapshot) =>
  customFieldsReconciler.plan(desired, snapshot, fixedPlanContext());

describe("カスタム属性の現状取得", () => {
  it("リスト型の選択肢は名前の並びとして持つ", async () => {
    const snapshot = await customFieldsReconciler.read(
      fixedReadContext({
        "/api/v2/projects/PROJ_A/customFields": [
          {
            id: 31,
            name: "環境",
            typeId: 5,
            description: "",
            required: false,
            applicableIssueTypes: [101],
            items: [
              { id: 1, name: "本番", displayOrder: 0 },
              { id: 2, name: "検証", displayOrder: 1 },
            ],
            allowInput: false,
            allowAddItem: false,
          },
        ],
      }),
    );

    expect(snapshot).toEqual([
      {
        id: 31,
        name: "環境",
        typeId: 5,
        description: "",
        required: false,
        items: ["本番", "検証"],
        allowInput: false,
        allowAddItem: false,
      },
    ]);
  });

  it("プロジェクトが未作成なら取得を行わず、空のスナップショットになる", async () => {
    const snapshot = await customFieldsReconciler.read(
      fixedReadContext({}, { snapshot: fixedSnapshot({ project: { exists: false } }) }),
    );

    expect(snapshot).toEqual([]);
  });
});

describe("カスタム属性の型", () => {
  it("型名は API の typeId に変換される", () => {
    const [action] = plan([{ name: "見積工数", type: "number" }], []);

    expect(action?.request?.params).toEqual({ name: "見積工数", typeId: 3 });
  });

  it("数値型の範囲は数値で送られる", () => {
    const [action] = plan([{ name: "見積工数", type: "number", min: 0, max: 40, unit: "h" }], []);

    expect(action?.request?.params).toEqual({
      name: "見積工数",
      typeId: 3,
      min: 0,
      max: 40,
      unit: "h",
    });
  });

  it("日付型の範囲は yyyy-MM-dd の文字列で送られる", () => {
    const [action] = plan(
      [
        {
          name: "検収日",
          type: "date",
          min: "2026-10-01",
          max: "2026-12-31",
          initialValueType: "specifiedDate",
          initialDate: "2026-10-01",
        },
      ],
      [],
    );

    expect(action?.request?.params).toEqual({
      name: "検収日",
      typeId: 4,
      min: "2026-10-01",
      max: "2026-12-31",
      initialValueType: 3,
      initialDate: "2026-10-01",
    });
  });

  it("リスト型の選択肢は記述順のまま送られる", () => {
    const [action] = plan(
      [{ name: "環境", type: "singleList", items: ["本番", "検証"], allowInput: false }],
      [],
    );

    expect(action?.request?.params).toEqual({
      name: "環境",
      typeId: 5,
      items: ["本番", "検証"],
      allowInput: false,
    });
  });
});

describe("カスタム属性の適用課題種別", () => {
  it("適用する課題種別は1リクエストにまとめて載る", () => {
    const [action] = plan(
      [{ name: "環境", type: "text", applicableIssueTypes: ["バグ", "タスク"] }],
      [],
    );

    expect(action?.request?.params.applicableIssueTypes).toEqual([
      { $ref: { kind: "issueType", name: "バグ" } },
      { $ref: { kind: "issueType", name: "タスク" } },
    ]);
  });

  it("まだ作成されていない課題種別は名前の参照として載る", () => {
    const [action] = plan([{ name: "環境", type: "text", applicableIssueTypes: ["調査"] }], []);

    expect(action?.request?.params.applicableIssueTypes).toEqual([
      { $ref: { kind: "issueType", name: "調査" } },
    ]);
  });

  it("適用する課題種別を書かなければ送らない（全種別が対象になる）", () => {
    const [action] = plan([{ name: "環境", type: "text" }], []);

    expect(action?.request?.params).toEqual({ name: "環境", typeId: 1 });
  });
});

describe("カスタム属性の差分", () => {
  it("一致しているカスタム属性には更新リクエストを出さない", () => {
    const actions = plan(
      [{ name: "見積工数", type: "number", min: 0, max: 40 }],
      [{ id: 31, name: "見積工数", typeId: 3, min: 0, max: 40 }],
    );

    expect(actions).toEqual([
      {
        id: "customFields/noop/見積工数",
        phase: 6,
        kind: "customField",
        op: "noop",
        name: "見積工数",
        target: 31,
        writeRequest: false,
      },
    ]);
  });

  it("選択肢の並びが違うリスト型は更新される", () => {
    const actions = plan(
      [{ name: "環境", type: "singleList", items: ["本番", "検証"] }],
      [{ id: 31, name: "環境", typeId: 5, items: ["検証", "本番"] }],
    );

    expect(actions.map(({ op }) => op)).toEqual(["update"]);
  });

  it("マニフェストに無い既存カスタム属性は削除される", () => {
    const actions = plan([], [{ id: 31, name: "環境", typeId: 1 }]);

    expect(actions).toEqual([
      {
        id: "customFields/delete/環境",
        phase: 6,
        kind: "customField",
        op: "delete",
        name: "環境",
        target: 31,
        request: {
          method: "DELETE",
          path: "/api/v2/projects/PROJ_A/customFields/31",
          params: {},
        },
        writeRequest: true,
      },
    ]);
  });

  it("追加・更新・削除の順に並ぶ", () => {
    const actions = plan(
      [
        { name: "見積工数", type: "number" },
        { name: "環境", type: "text", oldname: "環境名" },
      ],
      [
        { id: 31, name: "環境名", typeId: 1 },
        { id: 32, name: "検収日", typeId: 4 },
      ],
    );

    expect(actions.map(({ op, name }) => [op, name])).toEqual([
      ["create", "見積工数"],
      ["update", "環境"],
      ["delete", "検収日"],
    ]);
  });
});

describe("カスタム属性の oldname", () => {
  it("oldname のカスタム属性が存在すれば改名と他フィールドの更新が1リクエストになる", () => {
    const actions = plan(
      [{ name: "環境", type: "text", oldname: "環境名", description: "デプロイ先" }],
      [{ id: 31, name: "環境名", typeId: 1 }],
    );

    expect(actions).toEqual([
      {
        id: "customFields/update/環境",
        phase: 6,
        kind: "customField",
        op: "update",
        name: "環境",
        target: 31,
        request: {
          method: "PATCH",
          path: "/api/v2/projects/PROJ_A/customFields/31",
          params: { name: "環境", description: "デプロイ先" },
        },
        provides: [{ kind: "customField", name: "環境" }],
        changes: [
          { field: "name", before: "環境名", after: "環境" },
          { field: "description", before: null, after: "デプロイ先" },
        ],
        notes: [{ type: "renamed", from: "環境名" }],
        writeRequest: true,
      },
    ]);
  });

  it("改名を伴わない更新には renamed の注記が付かない", () => {
    const actions = plan(
      [{ name: "環境", type: "text", description: "デプロイ先" }],
      [{ id: 31, name: "環境", typeId: 1 }],
    );

    expect(actions).toEqual([
      {
        id: "customFields/update/環境",
        phase: 6,
        kind: "customField",
        op: "update",
        name: "環境",
        target: 31,
        request: {
          method: "PATCH",
          path: "/api/v2/projects/PROJ_A/customFields/31",
          params: { name: "環境", description: "デプロイ先" },
        },
        changes: [
          { field: "name", before: "環境", after: "環境" },
          { field: "description", before: null, after: "デプロイ先" },
        ],
        writeRequest: true,
      },
    ]);
  });

  it("name と同名が存在するときは oldname を見ない", () => {
    const actions = plan(
      [{ name: "環境", type: "text", oldname: "環境名" }],
      [
        { id: 31, name: "環境", typeId: 1 },
        { id: 32, name: "環境名", typeId: 1 },
      ],
    );

    expect(actions.map(({ op, name }) => [op, name])).toEqual([
      ["noop", "環境"],
      ["delete", "環境名"],
    ]);
  });

  it("name も oldname も存在しなければ作成になる", () => {
    expect(
      plan([{ name: "環境", type: "text", oldname: "環境名" }], []).map(({ op }) => op),
    ).toEqual(["create"]);
  });

  it("改名を適用した後の状態にもう一度計画すると何も起きない", () => {
    const actions = plan(
      [{ name: "環境", type: "text", oldname: "環境名", description: "デプロイ先" }],
      [{ id: 31, name: "環境", typeId: 1, description: "デプロイ先" }],
    );

    expect(actions.map(({ op }) => op)).toEqual(["noop"]);
  });
});

describe("環境変数から展開した値", () => {
  it("説明が ${ENV} 由来なら計画に実値が現れない", () => {
    const actions = customFieldsReconciler.plan(
      [{ name: "顧客名", type: "text", description: "社外秘の説明" }],
      [],
      fixedPlanContext({ isSecret: secretPaths("customFields/0/description") }),
    );

    expect(actions[0]?.request?.params.description).toBeInstanceOf(Secret);
    expect(JSON.stringify(actions)).not.toContain("社外秘の説明");
  });
});

describe("カスタム属性の型の変更", () => {
  it("同名で型だけが変われば、削除と作成の2件になる", () => {
    const actions = plan(
      [{ name: "環境", type: "singleList", items: ["本番", "検証"] }],
      [{ id: 31, name: "環境", typeId: 1 }],
    );

    expect(actions.map(({ op, name, target }) => [op, name, target])).toEqual([
      ["create", "環境", undefined],
      ["delete", "環境", 31],
    ]);
  });

  it("作り直しの作成には型が載り、前の値は持たない", () => {
    const [create] = plan(
      [{ name: "環境", type: "singleList", items: ["本番"] }],
      [{ id: 31, name: "環境", typeId: 1 }],
    );

    expect(create?.request).toEqual({
      method: "POST",
      path: "/api/v2/projects/PROJ_A/customFields",
      params: { name: "環境", typeId: 5, items: ["本番"] },
    });
    expect(create?.changes?.every(({ before }) => before === null)).toBe(true);
  });

  it("型が同じなら作り直さない", () => {
    const actions = plan(
      [{ name: "環境", type: "text", description: "デプロイ先" }],
      [{ id: 31, name: "環境", typeId: 1 }],
    );

    expect(actions.map(({ op }) => op)).toEqual(["update"]);
  });

  it("oldname で改名しながら型を変えても、削除と作成になる", () => {
    const actions = plan(
      [{ name: "環境", type: "number", oldname: "環境名" }],
      [{ id: 31, name: "環境名", typeId: 1 }],
    );

    expect(actions.map(({ op, name }) => [op, name])).toEqual([
      ["create", "環境"],
      ["delete", "環境名"],
    ]);
  });
});
