import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ResolvedHttpRequest } from "@backlog-blueprint/core";

import { createBacklogClient } from "./client";
import { BacklogHttpFailureError } from "./failure";

const API_KEY = "api-key-must-never-be-printed";

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

type Reply = { status: number; statusText?: string; body?: unknown; bytes?: ArrayBuffer };

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
      arrayBuffer: () => Promise.resolve(reply.bytes ?? new ArrayBuffer(0)),
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

describe("バイト列の取得", () => {
  it("本文を解釈せずにバイト列のまま返す", async () => {
    /** PNG の先頭4バイト。16進で書くと oxfmt が小文字に、oxlint が大文字に直させ合う */
    const bytes = new Uint8Array([137, 80, 78, 71]).buffer;
    const { client } = clientWith({ status: 200, bytes });

    await expect(client.getBytes("/api/v2/space/image")).resolves.toBe(bytes);
  });

  it("API キーはヘッダで送り、URL には載せない", async () => {
    const { calls, client } = clientWith({ status: 200 });

    await client.getBytes("/api/v2/users/1/icon");

    expect(calls[0]?.url).toBe("https://example.backlog.com/api/v2/users/1/icon");
    expect(calls[0]?.url).not.toContain(API_KEY);
  });

  it("失敗は JSON の取得と同じく状態コード付きで投げる", async () => {
    const { client } = clientWith({ status: 404, body: { errors: [{ message: "No icon" }] } });

    await expect(client.getBytes("/api/v2/space/image")).rejects.toBeInstanceOf(
      BacklogHttpFailureError,
    );
  });
});

const TIMEOUT_MS = 60_000;

type Stalled = { signals: AbortSignal[]; client: ReturnType<typeof createBacklogClient> };

/** 接続は張れたが Backlog が何も返さない。`signal` を見ない実装として、打ち切られても黙ったまま */
const stalled = (): Stalled => {
  const signals: AbortSignal[] = [];

  return {
    signals,
    client: createBacklogClient({
      space: "example.backlog.com",
      apiKey: API_KEY,
      fetch: ((_url: string, init: { signal: AbortSignal }) => {
        signals.push(init.signal);

        return new Promise(() => {});
      }) as never,
    }),
  };
};

/** ヘッダまでは返るが、本文が届かない */
const stalledBody = () =>
  createBacklogClient({
    space: "example.backlog.com",
    apiKey: API_KEY,
    fetch: ((url: string) =>
      Promise.resolve({
        url,
        status: 200,
        statusText: "",
        headers: { get: () => null },
        json: () => new Promise(() => {}),
        arrayBuffer: () => new Promise(() => {}),
      })) as never,
  });

const settle = <T>(promise: Promise<T>) => {
  const state: { settled: boolean; error?: unknown } = { settled: false };

  promise.then(
    () => {
      state.settled = true;
    },
    (error: unknown) => {
      state.settled = true;
      state.error = error;
    },
  );

  return state;
};

describe("応答を待つ上限", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("応答の無い取得は60秒で状態コードの無い失敗になる", async () => {
    const outcome = settle(stalled().client.get("/api/v2/space"));

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    expect(outcome.error).toBeInstanceOf(BacklogHttpFailureError);
    expect((outcome.error as BacklogHttpFailureError).status).toBeUndefined();
    expect((outcome.error as BacklogHttpFailureError).errors).toStrictEqual([
      { message: "No response from Backlog within 60 seconds." },
    ]);
  });

  it("60秒に届くまでは待ち続ける", async () => {
    const outcome = settle(stalled().client.get("/api/v2/space"));

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);

    expect(outcome.settled).toBe(false);
  });

  it("打ち切ったら fetch に渡した signal を中断し、接続を手放させる", async () => {
    const { client, signals } = stalled();
    const outcome = settle(client.get("/api/v2/space"));

    expect(signals[0]?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    expect(outcome.settled).toBe(true);
    expect(signals[0]?.aborted).toBe(true);
  });

  it("応答の無い更新系は、適用済みかもしれないと添えて失敗する", async () => {
    const outcome = settle(stalled().client.send(aRequest()));

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    expect(outcome.error).toBeInstanceOf(BacklogHttpFailureError);
    expect((outcome.error as BacklogHttpFailureError).status).toBeUndefined();
    expect((outcome.error as BacklogHttpFailureError).errors).toStrictEqual([
      { message: "No response from Backlog within 60 seconds." },
      { message: "The request may have been applied anyway." },
    ]);
  });

  it("本文の途中で止まった応答も60秒で打ち切る", async () => {
    const outcome = settle(stalledBody().get("/api/v2/space"));

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    expect(outcome.error).toMatchObject({
      errors: [{ message: "No response from Backlog within 60 seconds." }],
    });
  });

  it("画像の取得も60秒で打ち切る", async () => {
    const outcome = settle(stalledBody().getBytes("/api/v2/space/image"));

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    expect(outcome.error).toMatchObject({
      errors: [{ message: "No response from Backlog within 60 seconds." }],
    });
  });

  it("上限はリクエスト1件ごとに数え、前のリクエストの経過を持ち越さない", async () => {
    let calls = 0;
    const client = createBacklogClient({
      space: "example.backlog.com",
      apiKey: API_KEY,
      fetch: ((url: string) => {
        calls += 1;

        return calls === 1
          ? Promise.resolve({
              url,
              status: 200,
              statusText: "",
              headers: { get: () => null },
              json: () => Promise.resolve({}),
            })
          : new Promise(() => {});
      }) as never,
    });

    await client.get("/api/v2/space");
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);

    const second = settle(client.get("/api/v2/space"));

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);

    expect(second.settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);

    expect(second.settled).toBe(true);
  });

  it("間に合った応答は待ちを残さない", async () => {
    const { client } = clientWith({ status: 200, body: { id: 1 } }, { status: 400, body: {} });

    await client.get("/api/v2/users/myself");
    await client.send(aRequest()).catch(() => undefined);

    expect(vi.getTimerCount()).toBe(0);
  });

  it("タイムアウトの失敗に API キーが現れない", async () => {
    const outcome = settle(stalled().client.send(aRequest()));

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    const failure = outcome.error as BacklogHttpFailureError;

    expect(
      JSON.stringify({ ...failure, message: failure.message, stack: failure.stack }),
    ).not.toContain(API_KEY);
  });
});
