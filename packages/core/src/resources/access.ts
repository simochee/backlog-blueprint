import { type Action } from "../action";
import { asArray, asRecord, optionalString, requiredNumber, requiredString } from "../api-response";
import { type Access } from "../manifest";
import { type Reconciler } from "../reconciler";
import { type Value } from "../value";

export type AccessUser = { id: number; userId: string };

/**
 * `roleType` はスペース全体の権限で、`GET /users` だけが返す（API 制約「権限」）。
 * プロジェクト単位の取得には現れないので、`AccessUser` とは別の型にする。
 *
 * `name` と `mailAddress` を持つのは V-B4 が「書かれた値は誰の表示名／メールアドレスか」
 * を言えるようにするためだけで、計画にも送信にも載らない。取り込みを `optionalString` に
 * するのは、ヒントのための項目が欠けていることで読み取りを落としたくないため。
 */
export type SpaceUser = AccessUser & {
  roleType: number;
  name?: string;
  mailAddress?: string;
};

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
 * `excludeGroupMembers=true` を外すとチーム経由の参加者まで返る（要件定義 §2.6 / §6.3）。
 * 既定値のまま取ると、差集合が「チームの所属者を個人として削除する」Action を生む。
 */
const personalMembersPath = (projectKey: string): string =>
  `${usersPath(projectKey)}?excludeGroupMembers=true`;

const administratorsPath = (projectKey: string): string =>
  `/api/v2/projects/${projectKey}/administrators`;

const toUser = (value: unknown): AccessUser => {
  const user = asRecord(value);

  return { id: requiredNumber(user, "id"), userId: requiredString(user, "userId") };
};

const toUsers = (value: unknown): AccessUser[] => asArray(value).map((item) => toUser(item));

const toSpaceUsers = (value: unknown): SpaceUser[] =>
  asArray(value).map((item) => ({
    ...toUser(item),
    roleType: requiredNumber(asRecord(item), "roleType"),
    name: optionalString(asRecord(item), "name"),
    mailAddress: optionalString(asRecord(item), "mailAddress"),
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
 * 一致している Action にも既存の ID を載せる（§6.1）。`--output json` の消費側は
 * `noop` から「このリソースは意図的に一致している」を読むので、どのリソースと
 * 一致しているのかを指せないと、名前だけを頼りに引き直すことになる。
 */
const matched = (kind: AccessKind, name: string, target: number): Action => ({
  id: `${SECTIONS[kind]}/noop/${name}`,
  phase: PHASE,
  kind,
  op: "noop",
  name,
  target,
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

  /**
   * `isSecret` を引かない。`access` の各要素は同定名なので、`${ENV}` 由来でも
   * 包まない（E-7）。ここで包むと、解決表のキーにも `Action.id` にも使えなくなる。
   * `${ENV}` で書かれていたら V-A25 が警告する。
   */
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

    const joinedMembers = new Map(snapshot.members.map((user) => [user.userId, user.id]));
    const joinedTeams = new Map(snapshot.teams.map((team) => [team.name, team.id]));
    const grantedAdministrators = new Map(
      snapshot.administrators.map((user) => [user.userId, user.id]),
    );

    const teamsToAdd = desired.teams.map((name) => {
      const joined = joinedTeams.get(name);

      return joined === undefined
        ? added("projectTeam", name, teamsPath(projectKey), { teamId: teamId(name) })
        : matched("projectTeam", name, joined);
    });

    const membersToAdd = desiredMembers.map((login) => {
      const joined = joinedMembers.get(login);

      return joined === undefined
        ? added("projectMember", login, usersPath(projectKey), { userId: userId(login) })
        : matched("projectMember", login, joined);
    });

    const administratorsToGrant = desired.administrators.map((login) => {
      const granted = grantedAdministrators.get(login);

      return granted === undefined
        ? added("projectAdministrator", login, administratorsPath(projectKey), {
            userId: userId(login),
          })
        : matched("projectAdministrator", login, granted);
    });

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
