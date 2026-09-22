import { describe, expect, it } from "vitest";

import { type ResolvedHttpRequest } from "@backlog-blueprint/core";

import { createBacklogClient } from "./client";
import { BacklogHttpFailureError } from "./failure";

const API_KEY = "api-key-must-never-be-printed";

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

type Reply = { status: number; statusText?: string; body?: unknown };

const transport = (...replies: Reply[]) => {
  const calls: Call[] = [];
  const queued = [...replies];

  const fetch = (url: string, init: Record<string, unknown>) => {
    const headers = init["headers"] as Record<string, string>;

    calls.push({
      url,
      method: init["method"] as string,
      headers,
      ...(init["body"] === undefined ? {} : { body: init["body"] as string }),
    });

    const reply = queued.shift() ?? { status: 200, body: {} };

    return Promise.resolve({
      url,
      status: reply.status,
      statusText: reply.statusText ?? "",
      headers: { get: () => null },
      json: () =>
        reply.body === undefined
          ? Promise.reject(new SyntaxError("no body"))
          : Promise.resolve(reply.body),
    });
  };

  return { calls, fetch };
};

const clientWith = (...replies: Reply[]) => {
  const { calls, fetch } = transport(...replies);

  return {
    calls,
    client: createBacklogClient({
      space: "example.backlog.com",
      apiKey: API_KEY,
      fetch: fetch as never,
    }),
  };
};

const rejecting = (error: unknown) =>
  createBacklogClient({
    space: "example.backlog.com",
    apiKey: API_KEY,
    fetch: (() => Promise.reject(error)) as never,
  });

/** ブラウザの fetch と同じく、Window 以外のレシーバで呼ばれたら投げる。 */
const brandChecked = function (this: unknown, url: string) {
  if (this !== undefined && this !== globalThis) {
    throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
  }

  return Promise.resolve({
    url,
    status: 200,
    statusText: "",
    headers: { get: () => null },
    json: () => Promise.resolve({ id: 1 }),
  });
};

const aRequest = (overrides: Partial<ResolvedHttpRequest> = {}): ResolvedHttpRequest => ({
  method: "POST",
  path: "/api/v2/projects/PROJ_A/webhooks",
  params: {},
  ...overrides,
});

describe("送信", () => {
  it("スペースのドメインの /api/v2 配下に送る", async () => {
    const { calls, client } = clientWith();

    await client.get("/api/v2/projects/PROJ_A/issueTypes");

    expect(calls[0]?.url).toBe("https://example.backlog.com/api/v2/projects/PROJ_A/issueTypes");
  });

  it("API キーは Backlog-API-Key ヘッダで送り、クエリには載せない", async () => {
    const { calls, client } = clientWith();

    await client.get("/api/v2/users/myself");

    expect(calls[0]?.headers["Backlog-API-Key"]).toBe(API_KEY);
    expect(calls[0]?.url).not.toContain(API_KEY);
  });

  it("更新系の本文は form-urlencoded で送る", async () => {
    const { calls, client } = clientWith();

    await client.send(aRequest({ params: { name: "Slack 通知" } }));

    expect(calls[0]?.headers["Content-type"]).toBe("application/x-www-form-urlencoded");
    expect(calls[0]?.body).toBe("name=Slack%20%E9%80%9A%E7%9F%A5");
  });

  it("配列のパラメータは key[] を繰り返して送る", async () => {
    const { calls, client } = clientWith();

    await client.send(aRequest({ params: { activityTypeIds: [1, 2] } }));

    expect(calls[0]?.body).toBe("activityTypeIds%5B%5D=1&activityTypeIds%5B%5D=2");
  });

  it("空の配列は key[]= として本文に現れる", async () => {
    const { calls, client } = clientWith();

    await client.send(aRequest({ params: { applicableIssueTypes: [] } }));

    expect(calls[0]?.body).toBe("applicableIssueTypes%5B%5D=");
  });

  it("ブラウザの fetch が拒むレシーバ付きの呼び出しをしない", async () => {
    const client = createBacklogClient({
      space: "example.backlog.com",
      apiKey: API_KEY,
      fetch: brandChecked as never,
    });

    await expect(client.get("/api/v2/users/myself")).resolves.toStrictEqual({ id: 1 });
  });

  it("計画が選んだメソッドとパスをそのまま使う", async () => {
    const { calls, client } = clientWith();

    await client.send(
      aRequest({ method: "DELETE", path: "/api/v2/projects/PROJ_A/issueTypes/1234" }),
    );

    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toBe(
      "https://example.backlog.com/api/v2/projects/PROJ_A/issueTypes/1234",
    );
  });

  it("応答の本文を解釈して返す", async () => {
    const { client } = clientWith({ status: 201, body: { id: 42 } });

    await expect(client.send(aRequest())).resolves.toStrictEqual({ id: 42 });
  });
});

describe("送信パラメータ", () => {
  it("文字列値は本文に現れる", async () => {
    const { calls, client } = clientWith();

    await client.send(aRequest({ params: { hookUrl: "https://hooks.example/abc" } }));

    expect(calls[0]?.body).toBe("hookUrl=https%3A%2F%2Fhooks.example%2Fabc");
  });

  it("配列の文字列値も送る", async () => {
    const { calls, client } = clientWith();

    await client.send(aRequest({ params: { values: ["one", "two"] } }));

    expect(calls[0]?.body).toBe("values%5B%5D=one&values%5B%5D=two");
  });
});

describe("失敗", () => {
  it("Backlog が返したエラー本文を状態コードとともに投げる", async () => {
    const { client } = clientWith({
      status: 400,
      body: { errors: [{ message: "deletedTargetIssueTypeId is the same." }] },
    });

    await expect(client.send(aRequest())).rejects.toMatchObject({
      status: 400,
      errors: [{ message: "deletedTargetIssueTypeId is the same." }],
    });
  });

  it("404 も失敗として投げ、状態コードを残す", async () => {
    const { client } = clientWith({ status: 404, body: { errors: [{ message: "No project." }] } });

    const failure = await client.get("/api/v2/projects/NOPE").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BacklogHttpFailureError);
    expect(failure).toMatchObject({ status: 404 });
  });

  it("404 を undefined に読み替えない", async () => {
    const { client } = clientWith({ status: 404, body: { errors: [{ message: "No project." }] } });

    await expect(client.get("/api/v2/projects/NOPE")).rejects.toBeInstanceOf(
      BacklogHttpFailureError,
    );
  });

  it("エラー本文が無いときは状態コードから組み立てる", async () => {
    const { client } = clientWith({ status: 503, statusText: "Service Unavailable" });

    await expect(client.get("/api/v2/space")).rejects.toMatchObject({
      status: 503,
      errors: [{ message: "Service Unavailable" }],
    });
  });

  it("HTTP に到達しなかった失敗には状態コードを付けない", async () => {
    const failure = await rejecting(new TypeError("fetch failed"))
      .get("/api/v2/space")
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BacklogHttpFailureError);
    expect((failure as BacklogHttpFailureError).status).toBeUndefined();
    expect((failure as BacklogHttpFailureError).errors).toStrictEqual([
      { message: "fetch failed" },
    ]);
  });

  it("失敗のどこにも API キーが現れない", async () => {
    const { client } = clientWith({
      status: 401,
      body: { errors: [{ message: "Unauthorized." }] },
    });

    const failure = (await client
      .get("/api/v2/users/myself")
      .catch((error: unknown) => error)) as BacklogHttpFailureError;

    expect(
      JSON.stringify({ ...failure, message: failure.message, stack: failure.stack }),
    ).not.toContain(API_KEY);
  });
});
