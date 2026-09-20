import { describe, expect, it } from "vitest";

import { mockBacklog, type MockBacklog } from "./mock-backlog";

const YAMADA = { id: 1, userId: "yamada", roleType: 1 };

const TANAKA = { id: 2, userId: "tanaka", roleType: 2 };

const space = (): MockBacklog =>
  mockBacklog({
    executor: YAMADA,
    spaceUsers: [YAMADA, TANAKA],
    spaceTeams: [{ name: "開発チーム", members: ["tanaka"] }],
    projects: [
      { key: "PROJ_A", name: "プロジェクトA", members: ["yamada"], teams: ["開発チーム"] },
    ],
  });

type Reply = { status: number; body: unknown };

const call = async (
  backlog: MockBacklog,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body = "",
): Promise<Reply> => {
  const response = await backlog.fetch(`https://example.backlog.com${path}`, { method, body });

  return { status: response.status, body: await response.json() };
};

const messageOf = ({ body }: Reply): unknown =>
  (body as { errors?: { message: string }[] }).errors?.[0]?.message;

const idOf = ({ body }: Reply): number => (body as { id: number }).id;

const addReview = (backlog: MockBacklog): Promise<Reply> =>
  call(backlog, "POST", "/api/v2/projects/PROJ_A/statuses", "name=レビュー中&color=%233b9dbd");

describe("既定ステータス", () => {
  it("名前も色も変えられない", async () => {
    const backlog = space();
    const reply = await call(backlog, "PATCH", "/api/v2/projects/PROJ_A/statuses/1", "name=新規");

    expect(reply.status).not.toBe(200);
    expect(messageOf(reply)).toBe("No such status");
    expect(backlog.project("PROJ_A")?.statuses[0]?.name).toBe("未対応");
  });

  it("振替先を添えても削除できない", async () => {
    const backlog = space();
    const reply = await call(
      backlog,
      "DELETE",
      "/api/v2/projects/PROJ_A/statuses/1",
      "substituteStatusId=2",
    );

    expect(reply.status).not.toBe(200);
    expect(messageOf(reply)).toBe("Default status cannot be deleted. id: 1");
    expect(backlog.project("PROJ_A")?.statuses).toHaveLength(4);
  });
});

describe("カスタムステータスの削除", () => {
  it("振替先を書かなければ受け付けない", async () => {
    const backlog = space();
    const created = await addReview(backlog);
    const reply = await call(
      backlog,
      "DELETE",
      `/api/v2/projects/PROJ_A/statuses/${idOf(created)}`,
    );

    expect(reply.status).not.toBe(200);
    expect(backlog.project("PROJ_A")?.statuses).toHaveLength(5);
  });

  it("振替先を書けば消える", async () => {
    const backlog = space();
    const created = await addReview(backlog);
    const reply = await call(
      backlog,
      "DELETE",
      `/api/v2/projects/PROJ_A/statuses/${idOf(created)}`,
      "substituteStatusId=1",
    );

    expect(reply.status).toBe(200);
    expect(backlog.project("PROJ_A")?.statuses.map(({ name }) => name)).not.toContain("レビュー中");
  });
});

describe("プロジェクト管理者の付与", () => {
  it("スペース管理者は、プロジェクトに参加していても管理者にできない", async () => {
    const backlog = space();
    const reply = await call(
      backlog,
      "POST",
      "/api/v2/projects/PROJ_A/administrators",
      `userId=${YAMADA.id}`,
    );

    expect(reply.status).not.toBe(200);
    expect(messageOf(reply)).toBe("Only normal-user role can be a project administrator.");
    expect(backlog.project("PROJ_A")?.administrators).toEqual([]);
  });
});

describe("プロジェクトの参加者", () => {
  it("既定ではチーム経由の参加者まで返る", async () => {
    const reply = await call(space(), "GET", "/api/v2/projects/PROJ_A/users");

    expect(reply.body).toEqual([YAMADA, TANAKA]);
  });

  it("excludeGroupMembers=true を付けると個人参加者だけになる", async () => {
    const reply = await call(
      space(),
      "GET",
      "/api/v2/projects/PROJ_A/users?excludeGroupMembers=true",
    );

    expect(reply.body).toEqual([YAMADA]);
  });
});
