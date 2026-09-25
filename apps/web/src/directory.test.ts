import { type ReadContext } from "@backlog-blueprint/core";
import { mockBacklog, type MockBacklog } from "@backlog-blueprint/test-utils";
import { describe, expect, it } from "vitest";

import { readDirectory } from "./directory";

/**
 * 表から引く `fixedGet` ではなく、`count` / `offset` を解釈するモックに問い合わせる。
 * 1ページ目で止まる読み取りは、ここで一覧が欠けて見える。
 */
const teamsIn = (length: number): { backlog: MockBacklog; get: ReadContext["get"] } => {
  const backlog = mockBacklog({
    spaceTeams: Array.from({ length }, (_, index) => ({
      id: index + 1,
      name: `Team ${index + 1}`,
    })),
  });

  return {
    backlog,
    get: async (path) => {
      const response = await backlog.fetch(`https://example.backlog.com${path}`);

      return response.json();
    },
  };
};

describe("Teams ペインの一覧（WU-22 / RD-1）", () => {
  it("1ページに収まらない数のチームも、最後の1件まで並ぶ", async () => {
    const { get } = teamsIn(150);

    const entries = await readDirectory("teams", get);

    expect(entries).toHaveLength(150);
    expect(entries.at(-1)).toEqual({ value: 150, label: "Team 150", details: ["0 members"] });
  });

  it("ページは直列に、件数が上限に満たないページが返るまで取る", async () => {
    const { backlog, get } = teamsIn(200);

    await readDirectory("teams", get);

    expect(backlog.reads.map(({ path }) => path)).toEqual([
      "/api/v2/teams?count=100&offset=0",
      "/api/v2/teams?count=100&offset=100",
      "/api/v2/teams?count=100&offset=200",
    ]);
  });
});
