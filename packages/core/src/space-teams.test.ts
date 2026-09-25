import { describe, expect, it } from "vitest";

import { recordingGet } from "../../test-utils/src/index";
import { readSpaceTeams, spaceTeamsPage } from "./space-teams";

const teams = (from: number, count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: from + index, name: `Team ${from + index}` }));

describe("スペースのチーム一覧の取得（RD-1）", () => {
  it("1ページ目は上限の件数と offset 0 を指定して取る", () => {
    expect(spaceTeamsPage(0)).toBe("/api/v2/teams?count=100&offset=0");
  });

  it("1ページに収まれば1回しか取らない", async () => {
    const { get, requested } = recordingGet({ [spaceTeamsPage(0)]: teams(1, 3) });

    await expect(readSpaceTeams(get)).resolves.toEqual(teams(1, 3));
    expect(requested).toEqual([spaceTeamsPage(0)]);
  });

  it("上限ちょうどのページが返れば次のページを取り、件数が上限に満たないページで止める", async () => {
    const { get, requested } = recordingGet({
      [spaceTeamsPage(0)]: teams(1, 100),
      [spaceTeamsPage(100)]: teams(101, 100),
      [spaceTeamsPage(200)]: teams(201, 50),
    });

    await expect(readSpaceTeams(get)).resolves.toEqual(teams(1, 250));
    expect(requested).toEqual([spaceTeamsPage(0), spaceTeamsPage(100), spaceTeamsPage(200)]);
  });

  it("総数が上限の倍数なら、空のページが返った時点で止める", async () => {
    const { get, requested } = recordingGet({
      [spaceTeamsPage(0)]: teams(1, 100),
      [spaceTeamsPage(100)]: [],
    });

    await expect(readSpaceTeams(get)).resolves.toEqual(teams(1, 100));
    expect(requested).toEqual([spaceTeamsPage(0), spaceTeamsPage(100)]);
  });

  it("配列でない応答は落ちる", async () => {
    const { get } = recordingGet({ [spaceTeamsPage(0)]: { teams: [] } });

    await expect(readSpaceTeams(get)).rejects.toThrow("expected an array");
  });
});
