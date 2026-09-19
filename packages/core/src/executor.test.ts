import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recordingSend } from "../../test-utils/src/index";
import { type Action, type HttpRequest } from "./action";
import { type ExecuteContext, type ExecutionEvent } from "./execution";
import { execute } from "./executor";
import { type ResolutionTable } from "./resolution";
import { Secret } from "./secret";

class ApiError extends Error {
  readonly status: number;

  readonly errors: { message: string }[];

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errors = [{ message }];
  }
}

const anAction = (overrides: Partial<Action> = {}): Action => {
  const name = overrides.name ?? "バグ";

  return {
    id: `issueTypes/create/${name}`,
    phase: 2,
    kind: "issueType",
    op: "create",
    name,
    request: { method: "POST", path: "/api/v2/projects/PROJ/issueTypes", params: { name } },
    writeRequest: true,
    ...overrides,
  };
};

const aNoop = (name: string): Action => ({
  id: `issueTypes/noop/${name}`,
  phase: 2,
  kind: "issueType",
  op: "noop",
  name,
  writeRequest: false,
});

const aRefresh = (): Action => ({
  id: "project/refresh",
  phase: 1,
  kind: "project",
  op: "refresh",
  name: "PROJ",
  writeRequest: false,
});

const REFRESH_RESPONSES: Record<string, unknown> = {
  "/api/v2/projects/PROJ/issueTypes": [
    { id: 301, name: "タスク" },
    { id: 302, name: "バグ" },
  ],
  "/api/v2/projects/PROJ/statuses": [{ id: 1, name: "未対応" }],
};

const rateLimitBody = (resetAtSeconds: number) => ({
  rateLimit: {
    read: { limit: 600, remaining: 0, reset: resetAtSeconds },
    update: { limit: 150, remaining: 0, reset: resetAtSeconds },
  },
});

type Harness = {
  ctx: ExecuteContext;
  sentAt: number[];
  gotAt: number[];
  sent: { path: string; params: Record<string, unknown> }[];
};

const harness = (
  options: {
    send?: ExecuteContext["send"];
    responses?: Record<string, unknown>;
    resolutions?: ResolutionTable;
  } = {},
): Harness => {
  const sentAt: number[] = [];
  const gotAt: number[] = [];
  const responses = { ...REFRESH_RESPONSES, ...options.responses };
  const recorder = recordingSend(() => ({ id: 999 }));

  return {
    sentAt,
    gotAt,
    sent: recorder.sent,
    ctx: {
      projectKey: "PROJ",
      resolutions: options.resolutions ?? new Map(),
      get: (path) => {
        gotAt.push(Date.now());

        return path in responses
          ? Promise.resolve(responses[path])
          : Promise.reject(new Error(`No fixed response for GET ${path}`));
      },
      send: (request) => {
        sentAt.push(Date.now());

        return (options.send ?? recorder.send)(request);
      },
    },
  };
};

const run = async (actions: Action[], ctx: ExecuteContext): Promise<ExecutionEvent[]> => {
  const events: ExecutionEvent[] = [];
  let running = true;

  const consumed = (async () => {
    for await (const event of execute(actions, ctx)) {
      events.push(event);
    }

    running = false;
  })();

  for (;;) {
    await vi.advanceTimersByTimeAsync(1000);

    if (!running) {
      break;
    }
  }

  await consumed;

  return events;
};

const typesOf = (events: ExecutionEvent[]): string[] => events.map(({ type }) => type);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-19T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("適用の進行", () => {
  it("差分の無いリソースは実行されず、進捗の分母にも数えない", async () => {
    const { ctx, sent } = harness();
    const events = await run([aNoop("タスク"), aRefresh(), anAction()], ctx);

    expect(events[0]).toEqual({ type: "started", total: 2 });
    expect(
      events.filter((event) => event.type === "actionStarted").map(({ action }) => action.id),
    ).toEqual(["project/refresh", "issueTypes/create/バグ"]);
    expect(sent).toHaveLength(1);
  });

  it("再取得は更新系ではないが実行される", async () => {
    const { ctx } = harness();
    const events = await run([aRefresh()], ctx);

    expect(typesOf(events)).toEqual(["started", "actionStarted", "actionSucceeded", "finished"]);
    expect(ctx.resolutions.get("issueType:バグ")).toBe(302);
    expect(ctx.resolutions.get("status:未対応")).toBe(1);
  });

  it("全件が成功すると finished で終わる", async () => {
    const { ctx } = harness();
    const events = await run([anAction()], ctx);

    expect(events.at(-1)).toEqual({ type: "finished" });
  });
});

describe("レート制限", () => {
  it("更新系のリクエストは1秒以上あけて送られる", async () => {
    const { ctx, sentAt } = harness();

    await run(
      [
        anAction({ id: "issueTypes/create/1", name: "1" }),
        anAction({ id: "issueTypes/create/2", name: "2" }),
        anAction({ id: "issueTypes/create/3", name: "3" }),
      ],
      ctx,
    );

    expect(sentAt).toHaveLength(3);
    expect(sentAt[1]! - sentAt[0]!).toBeGreaterThanOrEqual(1000);
    expect(sentAt[2]! - sentAt[1]!).toBeGreaterThanOrEqual(1000);
  });

  it("GET には間隔を空けない", async () => {
    const { ctx, sentAt, gotAt } = harness();

    await run(
      [
        anAction({ id: "issueTypes/create/1", name: "1" }),
        aRefresh(),
        anAction({ id: "issueTypes/create/2", name: "2" }),
      ],
      ctx,
    );

    expect(gotAt.every((at) => at === sentAt[0])).toBe(true);
    expect(sentAt[1]! - sentAt[0]!).toBeGreaterThanOrEqual(1000);
  });

  it("429 を受けるとリセット時刻まで待って送り直す", async () => {
    const resetAt = Math.floor(Date.now() / 1000) + 5;
    let attempts = 0;
    const { ctx, sentAt } = harness({
      responses: { "/api/v2/rateLimit": rateLimitBody(resetAt) },
      send: () => {
        attempts += 1;

        return attempts === 1
          ? Promise.reject(new ApiError(429, "Too many requests"))
          : Promise.resolve({ id: 1 });
      },
    });

    const events = await run([anAction()], ctx);

    expect(events).toContainEqual({ type: "waiting", seconds: 5 });
    expect(attempts).toBe(2);
    expect(sentAt[1]! / 1000).toBeGreaterThanOrEqual(resetAt);
    expect(events.at(-1)).toEqual({ type: "finished" });
  });

  it("429 が続くと上限回数で諦めて中断する", async () => {
    let attempts = 0;
    const { ctx } = harness({
      responses: { "/api/v2/rateLimit": rateLimitBody(Math.floor(Date.now() / 1000) + 1) },
      send: () => {
        attempts += 1;

        return Promise.reject(new ApiError(429, "Too many requests"));
      },
    });

    const events = await run([anAction()], ctx);

    expect(attempts).toBe(4);
    expect(events.at(-2)).toEqual({
      type: "actionFailed",
      action: anAction(),
      status: 429,
      errors: [{ message: "Too many requests" }],
    });
    expect(events.at(-1)?.type).toBe("aborted");
  });
});

describe("失敗したとき", () => {
  it("中断レポートは適用済み・失敗・未適用の3つに分かれる", async () => {
    const first = anAction({ id: "issueTypes/create/1", name: "1" });
    const failing = anAction({ id: "issueTypes/create/2", name: "2" });
    const pending = anAction({ id: "issueTypes/create/3", name: "3" });
    const { ctx } = harness({
      send: (request) =>
        request.params["name"] === "2"
          ? Promise.reject(new ApiError(400, "Bad request"))
          : Promise.resolve({ id: 1 }),
    });

    const events = await run([aNoop("タスク"), first, failing, pending], ctx);
    const aborted = events.at(-1);

    expect(aborted).toEqual({
      type: "aborted",
      applied: [first],
      failed: failing,
      pending: [pending],
    });
  });

  it("失敗した後の Action は送られない", async () => {
    const { ctx, sentAt } = harness({
      send: () => Promise.reject(new ApiError(400, "Bad request")),
    });

    await run([anAction({ name: "a" }), anAction({ name: "b" })], ctx);

    expect(sentAt).toHaveLength(1);
  });

  it("HTTP のやり取りが成立しなかった失敗には status を付けない", async () => {
    const { ctx } = harness({ send: () => Promise.reject(new TypeError("Failed to fetch")) });
    const events = await run([anAction()], ctx);
    const failed = events.find((event) => event.type === "actionFailed");

    expect(failed).toEqual({
      type: "actionFailed",
      action: anAction(),
      errors: [{ message: "Failed to fetch" }],
    });
    expect(failed && "status" in failed).toBe(false);
  });

  it("解決できない参照を持つ Action は送らずに中断する", async () => {
    const { ctx, sent } = harness();
    const action = anAction({
      request: {
        method: "POST",
        path: "/api/v2/projects/PROJ/customFields",
        params: { applicableIssueTypes: [{ $ref: { kind: "issueType", name: "バグ" } }] },
      },
    });

    const events = await run([action], ctx);

    expect(sent).toHaveLength(0);
    expect(events.find((event) => event.type === "actionFailed")?.errors).toEqual([
      { message: 'Unresolved reference to issueType "バグ"' },
    ]);
    expect(events.at(-1)?.type).toBe("aborted");
  });
});

describe("解決表への登録", () => {
  it("成功した Action の provides はレスポンスの id で登録される", async () => {
    const { ctx } = harness();
    const events = await run([anAction({ provides: [{ kind: "issueType", name: "バグ" }] })], ctx);

    expect(ctx.resolutions.get("issueType:バグ")).toBe(999);
    expect(events.find((event) => event.type === "actionSucceeded")?.resolved).toEqual([
      { ref: { kind: "issueType", name: "バグ" }, id: 999 },
    ]);
  });

  it("改名すると旧名では参照できなくなる", async () => {
    const resolutions: ResolutionTable = new Map([["issueType:その他", 42]]);
    const { ctx } = harness({ resolutions, send: () => Promise.resolve({ id: 42 }) });

    await run(
      [
        anAction({
          id: "issueTypes/update/調査",
          op: "update",
          name: "調査",
          target: 42,
          request: { method: "PATCH", path: "/api/v2/projects/PROJ/issueTypes/42", params: {} },
          notes: [{ type: "renamed", from: "その他" }],
        }),
      ],
      ctx,
    );

    expect(resolutions.has("issueType:その他")).toBe(false);
    expect(resolutions.get("issueType:調査")).toBe(42);
  });
});

describe("秘匿値の扱い", () => {
  it("Executor は Secret を実値に戻さないまま送信層へ渡す", async () => {
    const { ctx, sent } = harness();
    const hookUrl = new Secret("https://hooks.example.test/T000/B000");
    const request: HttpRequest = {
      method: "POST",
      path: "/api/v2/projects/PROJ/webhooks",
      params: { name: "Slack 通知", hookUrl },
    };

    await run([anAction({ kind: "webhook", request })], ctx);

    expect(sent[0]?.params["hookUrl"]).toBe(hookUrl);
    expect(String(sent[0]?.params["hookUrl"])).toBe("***");
  });
});
