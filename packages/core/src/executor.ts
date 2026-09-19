/**
 * `import` に置き換えられない。`fetch.d.ts` は export を持たないグローバル宣言の
 * ファイルで、import すると module 扱いになって宣言がグローバルでなくなる。
 * 参照が要るのは、core を読む側（test-utils / cli / web）の program に
 * `fetch.d.ts` が入らず、`setTimeout` が下流でだけ見つからなくなるため。
 * consumer の `types` に足す案は、NFR-5 のガードを緩めるので採らない。
 */
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="./fetch.d.ts" />

import { type Action, type ProvidedRef } from "./action";
import { asArrayOf, asRecord, requiredNumber, requiredString } from "./api-response";
import { type ExecuteContext, type ExecutionEvent } from "./execution";
import { resolveRequest } from "./ref";
import { type ResolutionKey } from "./resolution";
import { type ResourceKind } from "./resource";

const WRITE_INTERVAL_MS = 1000;

/** X-4 が定める再試行の上限3回 */
const RATE_LIMIT_RETRY_LIMIT = 3;

/**
 * `refresh` が読み直す先は RF-1 が1箇所に定めており、`Action` には GET の
 * リクエストを載せる場所が無い（`HttpRequest` は更新系の3メソッドだけを持つ）。
 * reconciler 側に GET を戻すと C-2 の唯一の例外が例外でなくなるので、
 * 再取得の実体はここに置く。
 */
const REFRESHED = [
  /**
   * 課題種別だけ Action の `provides` を位置の順に当てる。既定の表示名はスペースの
   * 言語設定で変わり、新規プロジェクトでは取得するまで分からないので、返ってきた名前で
   * 登録すると計画が指す名前と食い違う（§4.1）。ステータスは ID が 1〜4 の固定値で、
   * 計画が名前ではなく ID で指すため、返ってきた名前をそのまま使ってよい。
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

/**
 * 応答の形を確かめる `asRecord` と違い、こちらは失敗しても投げない。ここで見るのは
 * エラー本文とレート制限の本文で、形が違えば「読めなかった」として扱う道が要る。
 * 投げると、API の失敗を報告する経路自体が別の例外で置き換わる。
 */
const optionalRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

const numericId = (value: unknown): number | undefined => {
  const id = optionalRecord(value)?.["id"];

  return typeof id === "number" ? id : undefined;
};

const messagesOf = (value: unknown): { message: string }[] | undefined => {
  const errors = optionalRecord(value)?.["errors"];

  if (!Array.isArray(errors)) {
    return undefined;
  }

  const messages = errors.map((error) => optionalRecord(error)?.["message"]);

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
  const status = optionalRecord(error)?.["status"];
  const errors = messagesOf(error) ?? [
    { message: String(optionalRecord(error)?.["message"] ?? error) },
  ];

  return typeof status === "number" ? { status, errors } : { errors };
};

const rateLimitReset = (body: unknown, section: "read" | "update"): number | undefined => {
  const reset = optionalRecord(optionalRecord(optionalRecord(body)?.["rateLimit"])?.[section])?.[
    "reset"
  ];

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

  const refresh = async (action: Action): Promise<Outcome> => {
    const responses: unknown[] = [];
    const resolved: { ref: ProvidedRef; id: number }[] = [];
    const slots = action.provides ?? [];

    for (const { kind, path, positional } of REFRESHED) {
      const response = await ctx.get(path(ctx.projectKey));

      responses.push(response);

      for (const [slot, { id, name }] of toNamedResources(response).entries()) {
        /**
         * 枠に当てる名前が無ければ登録しない。返ってきた名前で埋めると、計画が
         * 知らない名前が解決表に入るだけでなく、利用者がその名前を書いていた場合に
         * 別の枠を指させる（§4.1）。登録されなければ、その枠を指す Action が
         * 未解決参照として止まる。
         */
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
