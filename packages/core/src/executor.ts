// `import` に置き換えない。import すると `fetch.d.ts` が module 扱いになり、宣言が
// グローバルでなくなる。参照が無いと、core を読む側（test-utils / cli / web）でだけ
// `setTimeout` が見つからない。読む側の `types` に足す案は NFR-5 のガードを緩める。
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="./fetch.d.ts" />

import { type Action, executedActions, type ProvidedRef } from "./action";
import {
  asArrayOf,
  asRecord,
  requiredNumber,
  type HttpFailure,
  looseRecord,
  requiredString,
} from "./api-response";
import { type ExecuteContext, type ExecutionEvent } from "./execution";
import { resolveRequest } from "./ref";
import { type ResolutionKey } from "./resolution";
import { type ResourceKind } from "./resource";
import { toHttpFailure } from "./validation/http-failure";

const WRITE_INTERVAL_MS = 1000;

const RATE_LIMIT_RETRY_LIMIT = 3;

/**
 * 再取得の path を reconciler の `Action.request` に持たせない。GET を reconciler ごとに
 * 足せるようになり、C-2 の唯一の例外（RF-1）が例外でなくなる。
 */
const REFRESHED = [
  // 課題種別は返ってきた名前で登録しない。既定の表示名は言語設定で変わり、計画が指す
  // 名前と食い違う（§4.1）。ステータスは計画が ID で指すので名前をそのまま使ってよい。
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

type Outcome =
  | { ok: true; response: unknown; resolved: { ref: ProvidedRef; id: number }[] }
  | ({ ok: false } & HttpFailure);

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(() => resolve(), milliseconds);
  });

const numericId = (value: unknown): number | undefined => {
  const id = looseRecord(value)?.["id"];

  return typeof id === "number" ? id : undefined;
};

const rateLimitReset = (body: unknown, section: "read" | "update"): number | undefined => {
  const reset = looseRecord(looseRecord(looseRecord(body)?.["rateLimit"])?.[section])?.["reset"];

  return typeof reset === "number" ? reset : undefined;
};

const toNamedResources = (value: unknown): { id: number; name: string }[] =>
  asArrayOf(value, (item) => {
    const resource = asRecord(item);

    return { id: requiredNumber(resource, "id"), name: requiredString(resource, "name") };
  });

export const execute = async function* (
  actions: Action[],
  ctx: ExecuteContext,
): AsyncGenerator<ExecutionEvent, void> {
  const executed = executedActions(actions);

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

  const refresh = async (action: Action): Promise<Outcome> => {
    const responses: unknown[] = [];
    const resolved: { ref: ProvidedRef; id: number }[] = [];
    const slots = action.provides ?? [];

    for (const { kind, path, positional } of REFRESHED) {
      const response = await ctx.get(path(ctx.projectKey));

      responses.push(response);

      for (const [slot, { id, name }] of toNamedResources(response).entries()) {
        // 枠に当てる名前が無くても返ってきた名前で埋めない。利用者がその名前を書いていると
        // 別の枠を指させる（§4.1）。
        const ref = positional ? slots[slot] : { kind, name };

        if (ref === undefined) {
          continue;
        }

        ctx.resolutions.set(`${ref.kind}:${ref.name}`, id);
        resolved.push({ ref, id });
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
        return await refresh(action);
      }

      if (action.request === undefined) {
        return { ok: false, errors: [{ message: `Action ${action.id} has no request to send` }] };
      }

      return await send(action, action.request);
    } catch (error) {
      return { ok: false, ...toHttpFailure(error) };
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
