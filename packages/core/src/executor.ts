import { type Action, type ProvidedRef } from "./action";
import { type ExecuteContext, type ExecutionEvent } from "./execution";
import { resolveRequest } from "./ref";
import { defaultSlotName, type ResolutionKey } from "./resolution";
import { type ResourceKind } from "./resource";

/**
 * `lib` に `DOM` を足さず、ここで最小限の面だけを宣言する。`fetch` を
 * `fetch.d.ts` に写しているのと同じ理由で、`DOM` を足すと `window` や
 * `localStorage` まで型が通り NFR-5 のガードが緩む。X-1 / X-4 が待機を求める以上
 * タイマーは要るが、要るのは呼び出しの1つだけである。
 */
declare function setTimeout(callback: () => void, milliseconds: number): unknown;

const WRITE_INTERVAL_MS = 1000;

/**
 * X-4 の「上限回数」に相当する値。設計文書は回数を定めていないため、ここで決め打つ。
 */
const RATE_LIMIT_RETRY_LIMIT = 3;

/**
 * `refresh` が読み直す先は RF-1 が1箇所に定めており、`Action` には GET の
 * リクエストを載せる場所が無い（`HttpRequest` は更新系の3メソッドだけを持つ）。
 * reconciler 側に GET を戻すと C-2 の唯一の例外が例外でなくなるので、
 * 再取得の実体はここに置く。
 */
const REFRESHED = [
  /**
   * 課題種別だけ位置キーも登録する。新規プロジェクトの計画は既定の表示名を知らず、
   * 枠の位置でしか既定4件を指せない（§4.1）。ステータスは ID が 1〜4 の固定値なので
   * 位置で指す必要がない。
   */
  {
    kind: "issueType",
    path: (projectKey: string) => `/api/v2/projects/${projectKey}/issueTypes`,
    positional: true,
  },
  {
    kind: "status",
    path: (projectKey: string) => `/api/v2/projects/${projectKey}/statuses`,
    positional: false,
  },
] as const satisfies readonly {
  kind: ResourceKind;
  path: (projectKey: string) => string;
  positional: boolean;
}[];

type Failure = { status?: number; errors: { message: string }[] };

type Outcome =
  | { ok: true; response: unknown; resolved: { ref: ProvidedRef; id: number }[] }
  | ({ ok: false } & Failure);

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(() => resolve(), milliseconds);
  });

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

const numericId = (value: unknown): number | undefined => {
  const id = asRecord(value)?.["id"];

  return typeof id === "number" ? id : undefined;
};

const messagesOf = (value: unknown): { message: string }[] | undefined => {
  const errors = asRecord(value)?.["errors"];

  if (!Array.isArray(errors)) {
    return undefined;
  }

  const messages = errors.map((error) => asRecord(error)?.["message"]);

  return messages.every((message) => typeof message === "string")
    ? messages.map((message) => ({ message }))
    : undefined;
};

/**
 * `status` を必ず埋めない。HTTP のやり取りが成立しなかった失敗（タイムアウト・
 * 名前解決の失敗・ブラウザの CORS 失敗）には状態コードが存在せず、`0` などで
 * 埋めると消費側が「Backlog が拒否した」と「Backlog に届かなかった」を
 * 区別できなくなる（plan の出力仕様 §3.3）。
 */
const toFailure = (error: unknown): Failure => {
  const status = asRecord(error)?.["status"];
  const errors = messagesOf(error) ?? [{ message: String(asRecord(error)?.["message"] ?? error) }];

  return typeof status === "number" ? { status, errors } : { errors };
};

const rateLimitReset = (body: unknown, section: "read" | "update"): number | undefined => {
  const reset = asRecord(asRecord(asRecord(body)?.["rateLimit"])?.[section])?.["reset"];

  return typeof reset === "number" ? reset : undefined;
};

const toNamedResources = (value: unknown): { id: number; name: string }[] => {
  if (!Array.isArray(value)) {
    throw new TypeError("Unexpected Backlog API response: expected an array");
  }

  return value.map((item) => {
    const id = numericId(item);
    const name = asRecord(item)?.["name"];

    if (id === undefined || typeof name !== "string") {
      throw new TypeError("Unexpected Backlog API response: a resource needs an id and a name");
    }

    return { id, name };
  });
};

export const execute = async function* (
  actions: Action[],
  ctx: ExecuteContext,
): AsyncGenerator<ExecutionEvent, void> {
  /**
   * `noop` だけを落とし、`refresh` は残す。`refresh` は GET だが実行される Action で、
   * 進捗の分母にも中断レポートの位置にも数える（§6.1 / plan の出力仕様 §1.3）。
   */
  const executed = actions.filter(({ op }) => op !== "noop");

  let lastWriteAt: number | undefined;

  const paceWrites = async (): Promise<void> => {
    if (lastWriteAt === undefined) {
      return;
    }

    const elapsed = Date.now() - lastWriteAt;

    if (elapsed < WRITE_INTERVAL_MS) {
      await delay(WRITE_INTERVAL_MS - elapsed);
    }
  };

  const register = (action: Action, response: unknown): { ref: ProvidedRef; id: number }[] => {
    const registered = new Map<ResolutionKey, { ref: ProvidedRef; id: number }>();
    const responseId = numericId(response);
    const renamed = action.notes?.find(({ type }) => type === "renamed");

    const put = (ref: ProvidedRef, id: number): void => {
      const key: ResolutionKey = `${ref.kind}:${ref.name}`;

      ctx.resolutions.set(key, id);
      registered.set(key, { ref, id });
    };

    if (renamed !== undefined) {
      const previous = ctx.resolutions.get(`${action.kind}:${renamed.from}`);

      ctx.resolutions.delete(`${action.kind}:${renamed.from}`);

      const id = responseId ?? previous;

      if (id !== undefined) {
        put({ kind: action.kind, name: action.name }, id);
      }
    }

    if (responseId !== undefined) {
      for (const ref of action.provides ?? []) {
        put(ref, responseId);
      }
    }

    return [...registered.values()];
  };

  const refresh = async (): Promise<Outcome> => {
    const responses: unknown[] = [];
    const resolved: { ref: ProvidedRef; id: number }[] = [];

    for (const { kind, path, positional } of REFRESHED) {
      const response = await ctx.get(path(ctx.projectKey));

      responses.push(response);

      for (const [slot, { id, name }] of toNamedResources(response).entries()) {
        const names = positional ? [name, defaultSlotName(slot)] : [name];

        for (const registered of names) {
          ctx.resolutions.set(`${kind}:${registered}`, id);
          resolved.push({ ref: { kind, name: registered }, id });
        }
      }
    }

    return { ok: true, response: responses, resolved };
  };

  const send = async (action: Action, request: NonNullable<Action["request"]>) => {
    const resolution = resolveRequest(request, ctx.resolutions);

    if (!resolution.resolved) {
      return {
        ok: false as const,
        errors: resolution.unresolved.map(({ $ref }) => ({
          message: `Unresolved reference to ${$ref.kind} "${$ref.name}"`,
        })),
      };
    }

    lastWriteAt = Date.now();

    const response = await ctx.send(resolution.value);

    return { ok: true as const, response, resolved: register(action, response) };
  };

  const perform = async (action: Action): Promise<Outcome> => {
    try {
      if (action.op === "refresh") {
        return await refresh();
      }

      if (action.request === undefined) {
        return { ok: false, errors: [{ message: `Action ${action.id} has no request to send` }] };
      }

      return await send(action, action.request);
    } catch (error) {
      return { ok: false, ...toFailure(error) };
    }
  };

  const resetWaitMs = async (action: Action): Promise<number | undefined> => {
    try {
      const body = await ctx.get("/api/v2/rateLimit");
      const reset = rateLimitReset(body, action.op === "refresh" ? "read" : "update");

      return reset === undefined ? undefined : Math.max(0, reset * 1000 - Date.now());
    } catch {
      return undefined;
    }
  };

  yield { type: "started", total: executed.length };

  for (const [index, action] of executed.entries()) {
    if (action.writeRequest) {
      await paceWrites();
    }

    yield { type: "actionStarted", index, total: executed.length, action };

    let outcome = await perform(action);

    for (let retry = 0; retry < RATE_LIMIT_RETRY_LIMIT; retry += 1) {
      if (outcome.ok || outcome.status !== 429) {
        break;
      }

      const waitMs = await resetWaitMs(action);

      if (waitMs === undefined) {
        break;
      }

      yield { type: "waiting", seconds: Math.ceil(waitMs / 1000) };

      await delay(waitMs);

      if (action.writeRequest) {
        await paceWrites();
      }

      outcome = await perform(action);
    }

    if (!outcome.ok) {
      yield outcome.status === undefined
        ? { type: "actionFailed", action, errors: outcome.errors }
        : { type: "actionFailed", action, status: outcome.status, errors: outcome.errors };

      yield {
        type: "aborted",
        applied: executed.slice(0, index),
        failed: action,
        pending: executed.slice(index + 1),
      };

      return;
    }

    yield {
      type: "actionSucceeded",
      action,
      response: outcome.response,
      resolved: outcome.resolved,
    };
  }

  yield { type: "finished" };
};
