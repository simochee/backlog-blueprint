import { type Action, type Change } from "../action";
import { type Webhook } from "../manifest";
import { type Reconciler } from "../reconciler";
import { Secret } from "../secret";
import { type Value } from "../value";
import { WEBHOOK_EVENTS, type WebhookEvent } from "../webhook-events";

/**
 * `hookUrl` だけ `Secret` を受け付ける。マニフェストの型は素の文字列で、
 * `${ENV}` 由来の値を包むのは Action を組み立てる段（E-6）なので、
 * 包んだ値を渡せる口がここに要る。
 */
export type DesiredWebhook = Omit<Webhook, "hookUrl"> & { hookUrl: string | Secret };

export type ExistingWebhook = {
  id: number;
  name: string;
  description?: string;
  hookUrl: string;
  allEvent: boolean;
  activityTypeIds: number[];
};

export type WebhooksSnapshot = ExistingWebhook[];

const ALL_EVENTS = "all";

const EVENT_IDS_BY_NAME: ReadonlyMap<string, number> = new Map(
  WEBHOOK_EVENTS.map(({ id, name }) => [name, id]),
);

const collectionPath = (projectKey: string) => `/api/v2/projects/${projectKey}/webhooks`;

const memberPath = (projectKey: string, id: number) => `${collectionPath(projectKey)}/${id}`;

/**
 * 名前を落とすのは、S3 が未知の名前を既に弾いているため（W-4 前半）。
 * ここで落ちうるのは型の上でだけ起こりうる値で、利用者の誤りは隠れない。
 */
const activityTypeIdsOf = (events: WebhookEvent[]) => {
  const ids = events.flatMap((event) => {
    if (typeof event === "number") {
      return [event];
    }

    const id = EVENT_IDS_BY_NAME.get(event);

    return id === undefined ? [] : [id];
  });

  /**
   * `toSorted` に置き換えない。基底の tsconfig が `lib: ES2022` を置いているため
   * （NFR-5）、ES2023 のメソッドは型検査で落ちる。複製済みの配列を並べ替えるので
   * 破壊的でもない。
   */
  // oxlint-disable-next-line unicorn/no-array-sort
  return [...new Set(ids)].sort((left, right) => left - right);
};

const desiredEvents = (events: DesiredWebhook["events"]) =>
  events === ALL_EVENTS ? ALL_EVENTS : activityTypeIdsOf(events);

const existingEvents = ({ allEvent, activityTypeIds }: ExistingWebhook) =>
  allEvent ? ALL_EVENTS : activityTypeIdsOf(activityTypeIds);

const revealed = (value: Value | null) => (value instanceof Secret ? value.reveal() : value);

const sameValue = (before: Value | null, after: Value | null) => {
  const left = revealed(before);
  const right = revealed(after);

  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => item === right[index]);
  }

  return left === right;
};

/**
 * `events` はマニフェストのキー名のまま載せる（W-3）。送信の `allEvent` /
 * `activityTypeIds` に割ってしまうと、W-5 の「数値に名前を添えて表示する」対象が
 * 2つのフィールドに散る。
 */
const changesOf = (desired: DesiredWebhook, existing: ExistingWebhook | undefined): Change[] => [
  { field: "name", before: existing?.name ?? null, after: desired.name },
  ...(desired.description === undefined
    ? []
    : [
        {
          field: "description",
          before: existing?.description ?? null,
          after: desired.description,
        },
      ]),
  { field: "hookUrl", before: existing?.hookUrl ?? null, after: desired.hookUrl },
  {
    field: "events",
    before: existing === undefined ? null : existingEvents(existing),
    after: desiredEvents(desired.events),
  },
];

const paramsOf = (desired: DesiredWebhook): Record<string, Value> => {
  const events = desiredEvents(desired.events);

  return {
    name: desired.name,
    ...(desired.description === undefined ? {} : { description: desired.description }),
    hookUrl: desired.hookUrl,
    allEvent: events === ALL_EVENTS,
    ...(events === ALL_EVENTS ? {} : { activityTypeIds: events }),
  };
};

export const webhooksReconciler: Reconciler<DesiredWebhook[], WebhooksSnapshot> = {
  kind: "webhook",
  phase: 8,

  read: async ({ projectKey, snapshot, get }) => {
    if (!snapshot.project.exists) {
      return [];
    }

    const webhooks = (await get(collectionPath(projectKey))) as {
      id: number;
      name: string;
      description?: string | null;
      hookUrl: string;
      allEvent: boolean;
      activityTypeIds?: number[] | null;
    }[];

    return webhooks.map(({ id, name, description, hookUrl, allEvent, activityTypeIds }) => ({
      id,
      name,
      description: description ?? undefined,
      hookUrl,
      allEvent,
      activityTypeIds: activityTypeIds ?? [],
    }));
  },

  plan: (desired, snapshot, { manifest }) => {
    const creates: Action[] = [];
    const updates: Action[] = [];
    const kept = new Set<number>();

    for (const webhook of desired) {
      const existing = snapshot.find(({ name }) => name === webhook.name);
      const changes = changesOf(webhook, existing);

      if (existing === undefined) {
        creates.push({
          id: `webhooks/create/${webhook.name}`,
          phase: 8,
          kind: "webhook",
          op: "create",
          name: webhook.name,
          request: {
            method: "POST",
            path: collectionPath(manifest.key),
            params: paramsOf(webhook),
          },
          provides: [{ kind: "webhook", name: webhook.name }],
          changes,
          writeRequest: true,
        });

        continue;
      }

      kept.add(existing.id);

      if (changes.every(({ before, after }) => sameValue(before, after))) {
        updates.push({
          id: `webhooks/noop/${webhook.name}`,
          phase: 8,
          kind: "webhook",
          op: "noop",
          name: webhook.name,
          target: existing.id,
          writeRequest: false,
        });

        continue;
      }

      updates.push({
        id: `webhooks/update/${webhook.name}`,
        phase: 8,
        kind: "webhook",
        op: "update",
        name: webhook.name,
        target: existing.id,
        request: {
          method: "PATCH",
          path: memberPath(manifest.key, existing.id),
          params: paramsOf(webhook),
        },
        changes,
        writeRequest: true,
      });
    }

    const deletes = snapshot
      .filter(({ id }) => !kept.has(id))
      .map((existing): Action => ({
        id: `webhooks/delete/${existing.name}`,
        phase: 8,
        kind: "webhook",
        op: "delete",
        name: existing.name,
        target: existing.id,
        request: {
          method: "DELETE",
          path: memberPath(manifest.key, existing.id),
          params: {},
        },
        writeRequest: true,
      }));

    return [...creates, ...updates, ...deletes];
  },
};
