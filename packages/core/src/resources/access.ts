import { type Action } from "../action";
import { type Access } from "../manifest";
import { type Reconciler } from "../reconciler";
import { type Value } from "../value";

export type AccessUser = { id: number; userId: string };

export type AccessTeam = { id: number; name: string };

export type SpaceTeam = AccessTeam & { members: AccessUser[] };

export type AccessSnapshot = {
  teams: AccessTeam[];
  members: AccessUser[];
  administrators: AccessUser[];
  spaceUsers: AccessUser[];
  spaceTeams: SpaceTeam[];
};

const PHASE = 7;

const SECTIONS = {
  projectTeam: "projectTeams",
  projectMember: "projectMembers",
  projectAdministrator: "projectAdministrators",
} as const;

type AccessKind = keyof typeof SECTIONS;

const teamsPath = (projectKey: string): string => `/api/v2/projects/${projectKey}/teams`;

const usersPath = (projectKey: string): string => `/api/v2/projects/${projectKey}/users`;

/**
 * `excludeGroupMembers=true` を外すとチーム経由の参加者まで返る（要件定義 §2.6 / §6.3）。
 * 既定値のまま取ると、差集合が「チームの所属者を個人として削除する」Action を生む。
 */
const personalMembersPath = (projectKey: string): string =>
  `${usersPath(projectKey)}?excludeGroupMembers=true`;

const administratorsPath = (projectKey: string): string =>
  `/api/v2/projects/${projectKey}/administrators`;

const asArray = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) {
    throw new TypeError("Unexpected Backlog API response: expected an array");
  }

  return value;
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Unexpected Backlog API response: expected an object");
  }

  return value as Record<string, unknown>;
};

const toUser = (value: unknown): AccessUser => {
  const { id, userId } = asRecord(value);

  if (typeof id !== "number" || typeof userId !== "string") {
    throw new TypeError("Unexpected Backlog API response: a user needs a numeric id and a userId");
  }

  return { id, userId };
};

const toUsers = (value: unknown): AccessUser[] => asArray(value).map((item) => toUser(item));

const toTeam = (value: unknown): AccessTeam => {
  const { id, name } = asRecord(value);

  if (typeof id !== "number" || typeof name !== "string") {
    throw new TypeError("Unexpected Backlog API response: a team needs a numeric id and a name");
  }

  return { id, name };
};

const toTeams = (value: unknown): AccessTeam[] => asArray(value).map((item) => toTeam(item));

const toSpaceTeams = (value: unknown): SpaceTeam[] =>
  asArray(value).map((item) => ({
    ...toTeam(item),
    members: toUsers(asRecord(item).members ?? []),
  }));

const matched = (kind: AccessKind, name: string): Action => ({
  id: `${SECTIONS[kind]}/noop/${name}`,
  phase: PHASE,
  kind,
  op: "noop",
  name,
  writeRequest: false,
});

const added = (
  kind: AccessKind,
  name: string,
  path: string,
  params: Record<string, Value>,
): Action => ({
  id: `${SECTIONS[kind]}/create/${name}`,
  phase: PHASE,
  kind,
  op: "create",
  name,
  request: { method: "POST", path, params },
  writeRequest: true,
});

const removed = (
  kind: AccessKind,
  name: string,
  path: string,
  params: Record<string, number>,
  target: number,
): Action => ({
  id: `${SECTIONS[kind]}/delete/${name}`,
  phase: PHASE,
  kind,
  op: "delete",
  name,
  target,
  request: { method: "DELETE", path, params },
  writeRequest: true,
});

const unique = (names: string[]): string[] => [...new Set(names)];

export const accessReconciler: Reconciler<Access, AccessSnapshot> = {
  /**
   * フェーズ7の1つの reconciler が3種の `ResourceKind` を出す（§2.1）。`Reconciler` が
   * 持てる kind は1つなので、この値は代表にすぎない。実行も描画も個々の Action の
   * kind を見るため、ここを増やしても読む側は増えない。
   */
  kind: "projectTeam",
  phase: PHASE,

  read: async ({ projectKey, snapshot, get }) => {
    const spaceUsers = toUsers(await get("/api/v2/users"));
    const spaceTeams = toSpaceTeams(await get("/api/v2/teams"));

    if (snapshot.project.exists) {
      const teams = toTeams(await get(teamsPath(projectKey)));
      const members = toUsers(await get(personalMembersPath(projectKey)));
      const administrators = toUsers(await get(administratorsPath(projectKey)));

      return { teams, members, administrators, spaceUsers, spaceTeams };
    }

    return { teams: [], members: [], administrators: [], spaceUsers, spaceTeams };
  },

  plan: (desired, snapshot, { manifest }) => {
    const projectKey = manifest.key;

    const teamId = (name: string): Value =>
      snapshot.spaceTeams.find((team) => team.name === name)?.id ?? {
        $ref: { kind: "projectTeam", name },
      };

    const userId = (login: string): Value =>
      snapshot.spaceUsers.find((user) => user.userId === login)?.id ?? {
        $ref: { kind: "projectMember", name: login },
      };

    /**
     * `administrators` を差し引かずに合併する。§6.3 の表は「`members` ∪
     * （`administrators` のうち未参加の人）」と書いているが、それを削除側にも使うと、
     * `members` に書かれていない既参加の管理者が「Yaml に無い」と判定されて
     * 個人削除の対象になる。A-3（管理者は参加者でなければならない）を自分で壊す。
     * 追加側は差集合を取る段階で同じ結果になるので、合併で足りる。
     */
    const desiredMembers = unique([...desired.members, ...desired.administrators]);

    const joinedMembers = new Set(snapshot.members.map((user) => user.userId));
    const joinedTeams = new Set(snapshot.teams.map((team) => team.name));
    const grantedAdministrators = new Set(snapshot.administrators.map((user) => user.userId));

    const teamsToAdd = desired.teams.map((name) =>
      joinedTeams.has(name)
        ? matched("projectTeam", name)
        : added("projectTeam", name, teamsPath(projectKey), { teamId: teamId(name) }),
    );

    const membersToAdd = desiredMembers.map((login) =>
      joinedMembers.has(login)
        ? matched("projectMember", login)
        : added("projectMember", login, usersPath(projectKey), { userId: userId(login) }),
    );

    const administratorsToGrant = desired.administrators.map((login) =>
      grantedAdministrators.has(login)
        ? matched("projectAdministrator", login)
        : added("projectAdministrator", login, administratorsPath(projectKey), {
            userId: userId(login),
          }),
    );

    const administratorsToRevoke = snapshot.administrators
      .filter((user) => !desired.administrators.includes(user.userId))
      .map((user) =>
        removed(
          "projectAdministrator",
          user.userId,
          administratorsPath(projectKey),
          { userId: user.id },
          user.id,
        ),
      );

    const membersToRemove = snapshot.members
      .filter((user) => !desiredMembers.includes(user.userId))
      .map((user) =>
        removed("projectMember", user.userId, usersPath(projectKey), { userId: user.id }, user.id),
      );

    const teamsToRemove = snapshot.teams
      .filter((team) => !desired.teams.includes(team.name))
      .map((team) =>
        removed("projectTeam", team.name, teamsPath(projectKey), { teamId: team.id }, team.id),
      );

    return [
      ...teamsToAdd,
      ...membersToAdd,
      ...administratorsToGrant,
      ...administratorsToRevoke,
      ...membersToRemove,
      ...teamsToRemove,
    ];
  },
};
