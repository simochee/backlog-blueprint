import {
  asArray,
  asRecord,
  optionalString,
  requiredNumber,
  requiredString,
  type ReadContext,
} from "@backlog-blueprint/core";

export type DirectoryKind = "users" | "teams";

/**
 * `value` はマニフェストに写す値（ログイン ID かチーム ID）、`label` は人が探すときに
 * 読む値で、写すときには行末のコメントになる（WU-23 / A-6）。
 */
export type DirectoryEntry = { value: string | number; label: string; note?: string };

const SPACE_ADMINISTRATOR = 1;

const toUser = (item: unknown): DirectoryEntry => {
  const user = asRecord(item);
  const userId = requiredString(user, "userId");

  return {
    value: userId,
    label: optionalString(user, "name") || userId,
    ...(requiredNumber(user, "roleType") === SPACE_ADMINISTRATOR ? { note: "Space admin" } : {}),
  };
};

/**
 * `members` の欠落で読み取りを落とさない。人数は探す手掛かりにすぎず、写す値ではない。
 */
const toTeam = (item: unknown): DirectoryEntry => {
  const team = asRecord(item);
  const members = Array.isArray(team["members"]) ? team["members"].length : 0;

  return {
    value: requiredNumber(team, "id"),
    label: requiredString(team, "name"),
    note: `${members} ${members === 1 ? "member" : "members"}`,
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

export const matchesFilter = ({ value, label }: DirectoryEntry, filter: string): boolean => {
  const needle = filter.trim().toLowerCase();

  return (
    needle === "" ||
    String(value).toLowerCase().includes(needle) ||
    label.toLowerCase().includes(needle)
  );
};
