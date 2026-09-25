import { type Action } from "../action";
import { asArray, asRecord, optionalString, requiredNumber, requiredString } from "../api-response";
import { type Access } from "../manifest";
import { type Reconciler } from "../reconciler";
import { readSpaceTeams } from "../space-teams";
import { type Value } from "../value";

/**
 * ログイン ID（`userId`）は取り込まない。スペース管理者でないキーには本人以外の
 * `userId` が `null` で返る（API 制約「スペースのユーザー一覧」）ので、必須にすると
 * 一般ユーザーの読み取りがここで落ちる。マニフェストも数値 ID で書く（A-7）。
 *
 * `name` を `optionalString` にするのは、表示のための項目が欠けていることで読み取りを
 * 落としたくないため。
 */
export type AccessUser = { id: number; name?: string };

/**
 * `roleType` はスペース全体の権限で、`GET /users` だけが返す（API 制約「権限」）。
 * プロジェクト単位の取得には現れないので、`AccessUser` とは別の型にする。
 */
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
 * `excludeGroupMembers=true` を外すとチーム経由の参加者まで返る（要件定義 §2.6 / §6.3）。
 * 既定値のまま取ると、差集合が「チームの所属者を個人として削除する」Action を生む。
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

const toSpaceTeams = (items: unknown[]): SpaceTeam[] =>
  items.map((item) => ({
    ...toTeam(item),
    members: toUsers(asRecord(item).members ?? []),
  }));

/**
 * 一致している Action にも既存の ID を載せる（§6.1）。`--output json` の消費側は
 * `noop` から「このリソースは意図的に一致している」を読むので、どのリソースと
 * 一致しているのかを指せないと、名前だけを頼りに引き直すことになる。
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
  /**
   * フェーズ7の1つの reconciler が3種の `ResourceKind` を出す（§2.1）。`Reconciler` が
   * 持てる kind は1つなので、この値は代表にすぎない。実行も描画も個々の Action の
   * kind を見るため、ここを増やしても読む側は増えない。
   */
  kind: "projectTeam",
  phase: PHASE,

  read: async ({ projectKey, snapshot, get }) => {
    const spaceUsers = toSpaceUsers(await get("/api/v2/users"));
    const spaceTeams = toSpaceTeams(await readSpaceTeams(get));

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

    /**
     * `administrators` を差し引かずに合併する。§6.3 の表は「`members` ∪
     * （`administrators` のうち未参加の人）」と書いているが、それを削除側にも使うと、
     * `members` に書かれていない既参加の管理者が「Yaml に無い」と判定されて
     * 個人削除の対象になる。A-3（管理者は参加者でなければならない）を自分で壊す。
     * 追加側は差集合を取る段階で同じ結果になるので、合併で足りる。
     */
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

    /**
     * `Action.id` と表示名を分ける。名前はスペース内で重なりうる（A-6 / A-7）ので、
     * 名前で `id` を作ると同名の2件が同じ Action を指し、中断レポートがどちらまで
     * 進んだかを言えなくなる。表示は人が読むためにスペースの現在の名前で出す。
     */
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
