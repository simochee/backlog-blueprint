import { describe, expect, it } from "vitest";

import {
  fixedManifest,
  fixedResourceSnapshots,
  fixedSnapshot,
} from "../../../test-utils/src/index";
import { type Action } from "../action";
import { type ManifestInput } from "../manifest";
import { type ResourceSnapshots } from "../plan";
import { resultingOrder } from "../resulting-order";
import { type Snapshot } from "../snapshot";
import { validatePlan } from "./plan-stage";

type ActionInput = Partial<Action> & Pick<Action, "kind" | "op" | "name">;

const action = ({ kind, op, name, ...overrides }: ActionInput): Action => ({
  id: `${kind}/${op}/${name}`,
  phase: 2,
  kind,
  op,
  name,
  writeRequest: false,
  ...overrides,
});

const validate = (
  actions: Action[],
  overrides: {
    manifest?: Partial<ManifestInput>;
    snapshot?: Partial<Snapshot>;
    snapshots?: Partial<ResourceSnapshots>;
  } = {},
) => {
  const manifest = fixedManifest(overrides.manifest);
  const snapshots = fixedResourceSnapshots(overrides.snapshots);

  return validatePlan({
    manifest,
    snapshot: fixedSnapshot(overrides.snapshot),
    snapshots,
    actions,
    order: resultingOrder(manifest, snapshots, actions),
  });
};

const idsOf = (actions: Action[], overrides: Parameters<typeof validate>[1] = {}) =>
  validate(actions, overrides).map(({ id }) => id);

describe("実行者の締め出し（V-B6）", () => {
  it("実行者自身の管理者権限を外す計画は中断する", () => {
    const revoke = action({
      kind: "projectAdministrator",
      op: "delete",
      name: "yamada",
      phase: 7,
      target: 1,
      writeRequest: true,
    });

    expect(idsOf([revoke])).toEqual(["V-B6"]);
  });

  it("別の利用者の管理者権限を外す計画は通す", () => {
    const revoke = action({
      kind: "projectAdministrator",
      op: "delete",
      name: "suzuki",
      phase: 7,
      target: 9,
      writeRequest: true,
    });

    expect(idsOf([revoke])).toEqual([]);
  });

  it("誰を締め出すのかを名前で伝える", () => {
    const [diagnostic] = validate([
      action({
        kind: "projectAdministrator",
        op: "delete",
        name: "yamada",
        phase: 7,
        target: 1,
        writeRequest: true,
      }),
    ]);

    expect(diagnostic?.message).toContain("yamada");
    expect(diagnostic?.severity).toBe("error");
  });
});

describe("削除の振替先（V-B7）", () => {
  const deletion = (substitute: Action["request"]) =>
    action({
      kind: "issueType",
      op: "delete",
      name: "タスク",
      target: 5,
      request: substitute,
      writeRequest: true,
    });

  it("振替先が削除対象自身なら中断する", () => {
    const self = deletion({
      method: "DELETE",
      path: "/api/v2/projects/PROJ_A/issueTypes/5",
      params: { substituteIssueTypeId: { $ref: { kind: "issueType", name: "タスク" } } },
    });

    expect(idsOf([self])).toEqual(["V-B7"]);
  });

  it("振替先が別の課題種別なら通す", () => {
    const other = deletion({
      method: "DELETE",
      path: "/api/v2/projects/PROJ_A/issueTypes/5",
      params: { substituteIssueTypeId: { $ref: { kind: "issueType", name: "バグ" } } },
    });

    expect(idsOf([other])).toEqual([]);
  });

  it("ID で書かれた振替先が削除対象自身でも中断する", () => {
    const self = deletion({
      method: "DELETE",
      path: "/api/v2/projects/PROJ_A/statuses/5",
      params: { substituteStatusId: 5 },
    });

    expect(idsOf([self])).toEqual(["V-B7"]);
  });
});

const categories = (names: string[]) => names.map((name) => ({ name }));

describe("適用後の表示順（V-A15）", () => {
  const existingCategory = { id: 1, name: "インフラ" };

  it("既存の後ろに新規が付いて記述順とずれると警告する", () => {
    const actions = [
      action({ kind: "category", op: "create", name: "フロントエンド", phase: 4 }),
      action({ kind: "category", op: "create", name: "バックエンド", phase: 4 }),
      action({ kind: "category", op: "noop", name: "インフラ", phase: 4, target: 1 }),
    ];
    const [diagnostic] = validate(actions, {
      manifest: { categories: categories(["フロントエンド", "バックエンド", "インフラ"]) },
      snapshots: { categories: [existingCategory] },
    });

    expect(diagnostic).toMatchObject({ id: "V-A15", severity: "warning", path: "categories" });
    expect(diagnostic?.message).toContain("インフラ, フロントエンド, バックエンド");
  });

  it("直しようが無い理由を hint に書く", () => {
    const [diagnostic] = validate(
      [action({ kind: "category", op: "create", name: "フロントエンド", phase: 4 })],
      {
        manifest: { categories: categories(["フロントエンド", "インフラ"]) },
        snapshots: { categories: [existingCategory] },
      },
    );

    expect(diagnostic?.hint).toContain("no reorder API");
  });

  it("記述順どおりに並ぶなら警告しない", () => {
    const actions = [
      action({ kind: "category", op: "noop", name: "インフラ", phase: 4, target: 1 }),
      action({ kind: "category", op: "create", name: "フロントエンド", phase: 4 }),
    ];

    expect(
      idsOf(actions, {
        manifest: { categories: categories(["インフラ", "フロントエンド"]) },
        snapshots: { categories: [existingCategory] },
      }),
    ).toEqual([]);
  });

  it("並べ替え API があるステータスは対象にしない", () => {
    const actions = [
      action({ kind: "status", op: "create", name: "レビュー中", phase: 3 }),
      action({ kind: "status", op: "noop", name: "完了", phase: 3, target: 4 }),
    ];

    expect(
      idsOf(actions, {
        manifest: { statuses: [{ name: "レビュー中" }, { name: "完了" }] },
      }),
    ).toEqual([]);
  });

  it("改名された要素は新しい名前で並びに出る", () => {
    const renamed = action({
      kind: "category",
      op: "update",
      name: "基盤",
      phase: 4,
      target: 1,
      notes: [{ type: "renamed", from: "インフラ" }],
      writeRequest: true,
    });
    const [diagnostic] = validate([renamed], {
      manifest: { categories: categories(["フロントエンド", "基盤"]) },
      snapshots: { categories: [existingCategory] },
    });

    expect(diagnostic?.message).toContain("基盤");
  });
});

describe("チーム経由の重複記述（V-A16）", () => {
  const withTeam = {
    snapshots: {
      access: {
        teams: [],
        members: [],
        administrators: [],
        spaceUsers: [{ id: 9, userId: "suzuki" }],
        spaceTeams: [{ id: 3, name: "開発チーム", members: [{ id: 9, userId: "suzuki" }] }],
      },
    },
  };

  it("チーム経由で参加する人を members に書くと警告する", () => {
    const [diagnostic] = validate([], {
      ...withTeam,
      manifest: { access: { teams: ["開発チーム"], members: ["suzuki"] } },
    });

    expect(diagnostic).toMatchObject({
      id: "V-A16",
      severity: "warning",
      path: "access/members/0",
    });
    expect(diagnostic?.message).toContain("開発チーム");
  });

  it("書いても動くことを hint で伝える", () => {
    const [diagnostic] = validate([], {
      ...withTeam,
      manifest: { access: { teams: ["開発チーム"], members: ["suzuki"] } },
    });

    expect(diagnostic?.hint).toContain("also works");
  });

  it("チームを書いていなければ警告しない", () => {
    expect(idsOf([], { ...withTeam, manifest: { access: { members: ["suzuki"] } } })).toEqual([]);
  });

  it("管理者は個人参加が必須なので警告しない", () => {
    expect(
      idsOf([], {
        ...withTeam,
        manifest: { access: { teams: ["開発チーム"], administrators: ["suzuki"] } },
      }),
    ).toEqual([]);
  });
});

describe("更新系レート制限の残量（V-B8）", () => {
  const writes = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      action({
        kind: "category",
        op: "create",
        name: `分類${index}`,
        phase: 4,
        writeRequest: true,
      }),
    );

  it("残量より計画の操作数が多いと警告する", () => {
    const [diagnostic] = validate(writes(3), {
      manifest: { categories: [{ name: "分類0" }, { name: "分類1" }, { name: "分類2" }] },
      snapshot: { updateRateLimit: { limit: 150, remaining: 2, reset: 0 } },
    });

    expect(diagnostic).toMatchObject({ id: "V-B8", severity: "warning" });
    expect(diagnostic?.message).toContain("3");
    expect(diagnostic?.message).toContain("2");
  });

  it("残量が足りていれば警告しない", () => {
    expect(
      idsOf(writes(2), {
        manifest: { categories: [{ name: "分類0" }, { name: "分類1" }] },
        snapshot: { updateRateLimit: { limit: 150, remaining: 2, reset: 0 } },
      }),
    ).toEqual([]);
  });

  it("GET だけの Action は操作数に数えない", () => {
    const refresh = action({ kind: "project", op: "refresh", name: "PROJ_A", phase: 1 });

    expect(
      idsOf([refresh], { snapshot: { updateRateLimit: { limit: 150, remaining: 0, reset: 0 } } }),
    ).toEqual([]);
  });
});
