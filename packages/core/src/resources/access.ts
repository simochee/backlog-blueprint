import { type Action } from "../action";
import { asArray, asRecord, optionalString, requiredNumber, requiredString } from "../api-response";
import { type Access } from "../manifest";
import { type Reconciler } from "../reconciler";
import { type Value } from "../value";

/**
 * ログイン ID（`userId`）を取り込まない。スペース管理者でないキーには本人以外の `userId` が
 * `null` で返り（API 制約「スペースのユーザー一覧」）、一般ユーザーの読み取りが落ちる（A-7）。
 * 表示にしか使わない `name` も、欠けていて読み取りを落とさないよう必須にしない。
 */
export type AccessUser = { id: number; name?: string };

/** `AccessUser` に `roleType` を足さない。`GET /users` にしか現れない（API 制約「権限」）。 */
export type SpaceUser = AccessUser & { roleType: number };

export type AccessTeam = { id: number; name: string };

export type SpaceTeam = AccessTeam & { members: AccessUser[] };

export type AccessSnapshot = {
  teams: AccessTeam[];
  members: AccessUser[];
  administrators: AccessUser[];
  spaceUsers: SpaceUser[];
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
 * `excludeGroupMembers=true` を外さない。チーム経由の参加者まで返り、差集合がチームの
 * 所属者を個人として削除する（要件定義 §2.6 / §6.3）。
 */
const personalMembersPath = (projectKey: string): string =>
  `${usersPath(projectKey)}?excludeGroupMembers=true`;

const administratorsPath = (projectKey: string): string =>
  `/api/v2/projects/${projectKey}/administrators`;

const toUser = (value: unknown): AccessUser => {
  const user = asRecord(value);
  const name = optionalString(user, "name");

  return { id: requiredNumber(user, "id"), ...(name === undefined ? {} : { name }) };
};

const toUsers = (value: unknown): AccessUser[] => asArray(value).map((item) => toUser(item));

const toSpaceUsers = (value: unknown): SpaceUser[] =>
  asArray(value).map((item) => ({
    ...toUser(item),
    roleType: requiredNumber(asRecord(item), "roleType"),
  }));

const toTeam = (value: unknown): AccessTeam => {
  const team = asRecord(value);

  return { id: requiredNumber(team, "id"), name: requiredString(team, "name") };
};

const toTeams = (value: unknown): AccessTeam[] => asArray(value).map((item) => toTeam(item));

const toSpaceTeams = (value: unknown): SpaceTeam[] =>
  asArray(value).map((item) => ({
    ...toTeam(item),
    members: toUsers(asRecord(item).members ?? []),
  }));

/**
 * `noop` にも既存の ID を載せる。無いと `--output json` の消費側が、どれと一致したのかを
 * 名前だけで引き直すことになる（§6.1）。
 */
const matched = (kind: AccessKind, key: string, name: string, target: number): Action => ({
  id: `${SECTIONS[kind]}/noop/${key}`,
  phase: PHASE,
  kind,
  op: "noop",
  name,
  target,
  writeRequest: false,
});

const added = (
  kind: AccessKind,
  key: string,
  name: string,
  path: string,
  params: Record<string, Value>,
): Action => ({
  id: `${SECTIONS[kind]}/create/${key}`,
  phase: PHASE,
  kind,
  op: "create",
  name,
  request: { method: "POST", path, params },
  writeRequest: true,
});

const removed = (
  kind: AccessKind,
  key: string,
  name: string,
  path: string,
  params: Record<string, number>,
  target: number,
): Action => ({
  id: `${SECTIONS[kind]}/delete/${key}`,
  phase: PHASE,
  kind,
  op: "delete",
  name,
  target,
  request: { method: "DELETE", path, params },
  writeRequest: true,
});

const unique = (ids: number[]): number[] => [...new Set(ids)];

export const accessReconciler: Reconciler<Access, AccessSnapshot> = {
  // 3種の kind を出す reconciler の代表にすぎない（§2.1）。実行も描画も Action の kind を見る。
  kind: "projectTeam",
  phase: PHASE,

  read: async ({ projectKey, snapshot, get }) => {
    const spaceUsers = toSpaceUsers(await get("/api/v2/users"));
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

    // §6.3 の表どおり未参加の管理者だけを足す形にしない。削除側にも使うと、`members` に
    // 書かれていない既参加の管理者が個人削除の対象になり、A-3 を自分で壊す。
    const desiredMembers = unique([...desired.members, ...desired.administrators]);

    const joinedMembers = new Set(snapshot.members.map(({ id }) => id));
    const joinedTeams = new Set(snapshot.teams.map(({ id }) => id));
    const teamName = (id: number): string =>
      snapshot.spaceTeams.find((team) => team.id === id)?.name ?? `#${id}`;
    const userName = (id: number): string =>
      [...snapshot.spaceUsers, ...snapshot.members, ...snapshot.administrators].find(
        (user) => user.id === id,
      )?.name || `#${id}`;
    const grantedAdministrators = new Set(snapshot.administrators.map(({ id }) => id));

    // `Action.id` を名前で作らない。名前は重なりうるので（A-6 / A-7）、同名の2件が
    // 同じ Action を指し、中断レポートがどちらまで進んだかを言えなくなる。
    const teamsToAdd = desired.teams.map((id) =>
      joinedTeams.has(id)
        ? matched("projectTeam", String(id), teamName(id), id)
        : added("projectTeam", String(id), teamName(id), teamsPath(projectKey), { teamId: id }),
    );

    const membersToAdd = desiredMembers.map((id) =>
      joinedMembers.has(id)
        ? matched("projectMember", String(id), userName(id), id)
        : added("projectMember", String(id), userName(id), usersPath(projectKey), { userId: id }),
    );

    const administratorsToGrant = desired.administrators.map((id) =>
      grantedAdministrators.has(id)
        ? matched("projectAdministrator", String(id), userName(id), id)
        : added("projectAdministrator", String(id), userName(id), administratorsPath(projectKey), {
            userId: id,
          }),
    );

    const administratorsToRevoke = snapshot.administrators
      .filter(({ id }) => !desired.administrators.includes(id))
      .map(({ id }) =>
        removed(
          "projectAdministrator",
          String(id),
          userName(id),
          administratorsPath(projectKey),
          { userId: id },
          id,
        ),
      );

    const membersToRemove = snapshot.members
      .filter(({ id }) => !desiredMembers.includes(id))
      .map(({ id }) =>
        removed(
          "projectMember",
          String(id),
          userName(id),
          usersPath(projectKey),
          { userId: id },
          id,
        ),
      );

    const teamsToRemove = snapshot.teams
      .filter((team) => !desired.teams.includes(team.id))
      .map((team) =>
        removed(
          "projectTeam",
          String(team.id),
          team.name,
          teamsPath(projectKey),
          { teamId: team.id },
          team.id,
        ),
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
