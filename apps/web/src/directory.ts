import {
  asArray,
  asRecord,
  optionalString,
  requiredNumber,
  requiredString,
  SPACE_ADMINISTRATOR_ROLE_TYPE,
  type ReadContext,
} from "@backlog-blueprint/core";

export type DirectoryKind = "users" | "teams";

/** `details` はマニフェストに写さない。表示と絞り込みのための手掛かりにすぎない（WU-56） */
export type DirectoryEntry = {
  value: number;
  label: string;
  administrator?: boolean;
  details: string[];
};

/**
 * ログイン ID を必須にしない。スペース管理者でないキーには本人以外の `userId` が
 * `null` で返る（API 制約「スペースのユーザー一覧」）。返ったときだけ手掛かりに足す。
 */
const toUser = (item: unknown): DirectoryEntry => {
  const user = asRecord(item);
  const id = requiredNumber(user, "id");
  const details = [optionalString(user, "userId"), optionalString(user, "mailAddress")];

  return {
    value: id,
    label: optionalString(user, "name") || String(id),
    ...(requiredNumber(user, "roleType") === SPACE_ADMINISTRATOR_ROLE_TYPE
      ? { administrator: true }
      : {}),
    details: details.filter((detail): detail is string => detail !== undefined && detail !== ""),
  };
};

/** `members` の欠落で読み取りを落とさない。人数は探す手掛かりにすぎず、写す値ではない */
const toTeam = (item: unknown): DirectoryEntry => {
  const team = asRecord(item);
  const members = Array.isArray(team["members"]) ? team["members"].length : 0;

  return {
    value: requiredNumber(team, "id"),
    label: requiredString(team, "name"),
    details: [`${members} ${members === 1 ? "member" : "members"}`],
  };
};

const SOURCES: Record<DirectoryKind, { path: string; toEntry: (item: unknown) => DirectoryEntry }> =
  {
    users: { path: "/api/v2/users", toEntry: toUser },
    teams: { path: "/api/v2/teams", toEntry: toTeam },
  };

export const readDirectory = async (
  kind: DirectoryKind,
  get: ReadContext["get"],
): Promise<DirectoryEntry[]> => {
  const { path, toEntry } = SOURCES[kind];

  return asArray(await get(path)).map((item) => toEntry(item));
};

export const matchesFilter = (
  { value, label, details }: DirectoryEntry,
  filter: string,
): boolean => {
  const needle = filter.trim().toLowerCase();

  return (
    needle === "" ||
    [String(value), label, ...details].some((text) => text.toLowerCase().includes(needle))
  );
};
