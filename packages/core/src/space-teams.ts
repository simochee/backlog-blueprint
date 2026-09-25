import { asArray } from "./api-response";
import { type ReadContext } from "./reconciler";

const SPACE_TEAMS_PAGE_SIZE = 100;

export const spaceTeamsPage = (offset: number): string =>
  `/api/v2/teams?count=${SPACE_TEAMS_PAGE_SIZE}&offset=${offset}`;

const readFrom = async (get: ReadContext["get"], offset: number): Promise<unknown[]> => {
  const page = asArray(await get(spaceTeamsPage(offset)));

  return page.length < SPACE_TEAMS_PAGE_SIZE
    ? page
    : [...page, ...(await readFrom(get, offset + SPACE_TEAMS_PAGE_SIZE))];
};

/**
 * RD-1。ページの大きさと終わりの判定をここにしか置かない。V-B5 と Web UI の Teams ペインが
 * 別々に辿ると、片方だけが1ページ目で止まる。
 */
export const readSpaceTeams = (get: ReadContext["get"]): Promise<unknown[]> => readFrom(get, 0);
