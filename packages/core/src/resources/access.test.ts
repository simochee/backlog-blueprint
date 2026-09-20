import { describe, expect, it } from "vitest";

import {
  fixedManifest,
  fixedPlanContext,
  fixedReadContext,
  fixedSnapshot,
} from "../../../test-utils/src/index";
import { type Action } from "../action";
import { type Access } from "../manifest";
import { accessReconciler, type AccessSnapshot } from "./access";

const suzuki = { id: 11, userId: "suzuki" };
const tanaka = { id: 12, userId: "tanaka" };
const yamada = { id: 13, userId: "yamada" };

/** `roleType` を返すのはスペースの利用者一覧だけで、プロジェクト側の取得には現れない */
const inSpace = (user: { id: number; userId: string }) => ({ ...user, roleType: 2 });

const developers = { id: 21, name: "開発チーム", members: [tanaka] };
const qa = { id: 22, name: "QA", members: [] };

const joined = (team: { id: number; name: string }) => ({ id: team.id, name: team.name });

const SPACE = {
  spaceUsers: [suzuki, tanaka, yamada].map(inSpace),
  spaceTeams: [developers, qa],
};

const SPACE_RESPONSES = {
  "/api/v2/users": SPACE.spaceUsers,
  "/api/v2/teams": SPACE.spaceTeams,
};

const emptyProject: AccessSnapshot = {
  teams: [],
  members: [],
  administrators: [],
  ...SPACE,
};

const planOf = (access: Partial<Access>, current: Partial<AccessSnapshot> = {}): Action[] => {
  const manifest = fixedManifest({ access });

  return accessReconciler.plan(
    manifest.access,
    { ...emptyProject, ...current },
    fixedPlanContext({ manifest }),
  );
};

const idsOf = (actions: Action[]): string[] => actions.map(({ id }) => id);

const writesOf = (actions: Action[]): string[] =>
  idsOf(actions.filter(({ writeRequest }) => writeRequest));

const paramsOf = (actions: Action[], id: string): Record<string, unknown> | undefined =>
  actions.find((action) => action.id === id)?.request?.params;

describe("現状の取得", () => {
  it("プロジェクトの参加者は個人参加者だけに絞って取得する", async () => {
    const snapshot = await accessReconciler.read(
      fixedReadContext({
        ...SPACE_RESPONSES,
        "/api/v2/projects/PROJ_A/teams": [joined(developers)],
        "/api/v2/projects/PROJ_A/users": [suzuki, tanaka],
        "/api/v2/projects/PROJ_A/users?excludeGroupMembers=true": [suzuki],
        "/api/v2/projects/PROJ_A/administrators": [yamada],
      }),
    );

    expect(snapshot.members).toEqual([suzuki]);
    expect(snapshot.teams).toEqual([joined(developers)]);
    expect(snapshot.administrators).toEqual([yamada]);
  });

  it("スペースの利用者とチームは、プロジェクトが未作成でも取得する", async () => {
    const snapshot = await accessReconciler.read(
      fixedReadContext(SPACE_RESPONSES, {
        snapshot: fixedSnapshot({ project: { exists: false } }),
      }),
    );

    expect(snapshot.spaceUsers).toEqual(SPACE.spaceUsers);
    expect(snapshot.spaceTeams).toEqual(SPACE.spaceTeams);
    expect(snapshot).toMatchObject({ teams: [], members: [], administrators: [] });
  });

  it("スペースの利用者には roleType が含まれる", async () => {
    const snapshot = await accessReconciler.read(
      fixedReadContext(SPACE_RESPONSES, {
        snapshot: fixedSnapshot({ project: { exists: false } }),
      }),
    );

    expect(snapshot.spaceUsers.map(({ roleType }) => roleType)).toEqual([2, 2, 2]);
  });

  it("スペースのチームには所属者が含まれる", async () => {
    const snapshot = await accessReconciler.read(
      fixedReadContext(SPACE_RESPONSES, {
        snapshot: fixedSnapshot({ project: { exists: false } }),
      }),
    );

    expect(snapshot.spaceTeams[0]?.members).toEqual([tanaka]);
  });
});

describe("チーム経由の参加者", () => {
  it("チーム経由で参加している人は個人として削除されない", async () => {
    const manifest = fixedManifest({ access: { teams: ["開発チーム"], members: ["suzuki"] } });
    const current = await accessReconciler.read(
      fixedReadContext({
        ...SPACE_RESPONSES,
        "/api/v2/projects/PROJ_A/teams": [joined(developers)],
        "/api/v2/projects/PROJ_A/users": [suzuki, tanaka],
        "/api/v2/projects/PROJ_A/users?excludeGroupMembers=true": [suzuki],
        "/api/v2/projects/PROJ_A/administrators": [],
      }),
    );

    const actions = accessReconciler.plan(manifest.access, current, fixedPlanContext({ manifest }));

    expect(writesOf(actions)).toEqual([]);
    expect(actions.every(({ name }) => name !== tanaka.userId)).toBe(true);
  });

  it("チーム所属者が members にも書かれていれば個人参加させる", () => {
    const actions = planOf(
      { teams: ["開発チーム"], members: ["tanaka"] },
      { teams: [joined(developers)] },
    );

    expect(writesOf(actions)).toEqual(["projectMembers/create/tanaka"]);
    expect(paramsOf(actions, "projectMembers/create/tanaka")).toEqual({ userId: tanaka.id });
  });
});

describe("管理者", () => {
  it("管理者に指定された未参加者には個人参加が先に流れる", () => {
    const actions = planOf({ administrators: ["yamada"] });

    expect(writesOf(actions)).toEqual([
      "projectMembers/create/yamada",
      "projectAdministrators/create/yamada",
    ]);
  });

  it("既に個人参加している管理者には参加のリクエストを打たない", () => {
    const actions = planOf({ administrators: ["yamada"] }, { members: [yamada] });

    expect(writesOf(actions)).toEqual(["projectAdministrators/create/yamada"]);
  });

  it("members に書かれていない管理者も個人参加から外されない", () => {
    const actions = planOf(
      { administrators: ["yamada"] },
      { members: [yamada], administrators: [yamada] },
    );

    expect(writesOf(actions)).toEqual([]);
  });

  it("Yaml から消えた管理者は管理者権限だけでなく個人参加も外れる", () => {
    const actions = planOf({}, { members: [yamada], administrators: [yamada] });

    expect(writesOf(actions)).toEqual([
      "projectAdministrators/delete/yamada",
      "projectMembers/delete/yamada",
    ]);
    expect(paramsOf(actions, "projectMembers/delete/yamada")).toEqual({ userId: yamada.id });
  });
});

describe("フェーズ7の並び", () => {
  it("追加を先に、削除を後に並べる", () => {
    const actions = planOf(
      { teams: ["QA"], members: ["suzuki"], administrators: ["yamada"] },
      { teams: [joined(developers)], members: [tanaka], administrators: [tanaka] },
    );

    expect(writesOf(actions)).toEqual([
      "projectTeams/create/QA",
      "projectMembers/create/suzuki",
      "projectMembers/create/yamada",
      "projectAdministrators/create/yamada",
      "projectAdministrators/delete/tanaka",
      "projectMembers/delete/tanaka",
      "projectTeams/delete/開発チーム",
    ]);
  });

  it("一致しているものは noop として残る", () => {
    const actions = planOf(
      { teams: ["開発チーム"], members: ["suzuki"] },
      { teams: [joined(developers)], members: [suzuki] },
    );

    expect(idsOf(actions)).toEqual(["projectTeams/noop/開発チーム", "projectMembers/noop/suzuki"]);
    expect(actions.every(({ writeRequest }) => !writeRequest)).toBe(true);
  });
});

describe("チーム", () => {
  it("チームの追加にはスペースのチーム ID を使う", () => {
    const actions = planOf({ teams: ["開発チーム"] });

    expect(paramsOf(actions, "projectTeams/create/開発チーム")).toEqual({ teamId: developers.id });
  });

  it("Yaml に無いチームは外す", () => {
    const actions = planOf({}, { teams: [joined(qa)] });

    expect(writesOf(actions)).toEqual(["projectTeams/delete/QA"]);
    expect(paramsOf(actions, "projectTeams/delete/QA")).toEqual({ teamId: qa.id });
  });
});

describe("一致している参加の表し方", () => {
  it("一致しているチーム・個人・管理者には既存の ID が載る", () => {
    const actions = planOf(
      { teams: ["開発チーム"], members: ["suzuki"], administrators: ["yamada"] },
      {
        teams: [joined(developers)],
        members: [suzuki, yamada],
        administrators: [yamada],
      },
    );

    expect(
      actions.filter(({ op }) => op === "noop").map(({ name, target }) => [name, target]),
    ).toEqual([
      ["開発チーム", developers.id],
      ["suzuki", suzuki.id],
      ["yamada", yamada.id],
      ["yamada", yamada.id],
    ]);
  });
});

describe("応答の検査", () => {
  it("形の違う応答は取り込む時点で落ちる", async () => {
    await expect(
      accessReconciler.read(fixedReadContext({ ...SPACE_RESPONSES, "/api/v2/users": {} })),
    ).rejects.toThrow(TypeError);
  });

  it("スペースの利用者に roleType が無い応答も落ちる", async () => {
    await expect(
      accessReconciler.read(
        fixedReadContext({ ...SPACE_RESPONSES, "/api/v2/users": [{ id: 1, userId: "suzuki" }] }),
      ),
    ).rejects.toThrow("roleType");
  });

  it("ユーザーに userId が無い応答も落ちる", async () => {
    await expect(
      accessReconciler.read(
        fixedReadContext({ ...SPACE_RESPONSES, "/api/v2/users": [{ id: 1, roleType: 2 }] }),
      ),
    ).rejects.toThrow("userId");
  });
});

describe("冪等性（NFR-4）", () => {
  it("適用後の現状に同じマニフェストを当てると全部 noop になる", () => {
    const actions = planOf(
      {
        teams: ["開発チーム"],
        members: ["suzuki"],
        administrators: ["yamada"],
      },
      {
        teams: [joined(developers)],
        members: [suzuki, yamada],
        administrators: [yamada],
      },
    );

    expect(actions.every(({ op }) => op === "noop")).toBe(true);
  });
});
