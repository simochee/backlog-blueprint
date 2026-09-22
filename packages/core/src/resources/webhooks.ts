import { type Action, type Change } from "../action";
import { type Webhook } from "../manifest";
import { type Reconciler } from "../reconciler";
import { type Value } from "../value";
import { ascendingEventIds, WEBHOOK_EVENTS, type WebhookEvent } from "../webhook-events";
import {
  asArrayOf,
  asRecord,
  numbers,
  optionalString,
  requiredBoolean,
  requiredNumber,
  requiredString,
} from "../api-response";

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

  return ascendingEventIds(ids);
};

const desiredEvents = (events: Webhook["events"]) =>
  events === ALL_EVENTS ? ALL_EVENTS : activityTypeIdsOf(events);

const existingEvents = ({ allEvent, activityTypeIds }: ExistingWebhook) =>
  allEvent ? ALL_EVENTS : activityTypeIdsOf(activityTypeIds);

const sameValue = (before: Value | null, after: Value | null) => {
  const left = before;
  const right = after;

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
const changesOf = (desired: Webhook, existing: ExistingWebhook | undefined): Change[] => [
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

const paramsOf = (desired: Webhook): Record<string, Value> => {
  const events = desiredEvents(desired.events);

  return {
    name: desired.name,
    ...(desired.description === undefined ? {} : { description: desired.description }),
    hookUrl: desired.hookUrl,
    allEvent: events === ALL_EVENTS,
    ...(events === ALL_EVENTS ? {} : { activityTypeIds: events }),
  };
};

export const webhooksReconciler: Reconciler<Webhook[], WebhooksSnapshot> = {
  kind: "webhook",
  phase: 8,

  read: async ({ projectKey, snapshot, get }) => {
    if (!snapshot.project.exists) {
      return [];
    }

    return asArrayOf(await get(collectionPath(projectKey)), (item) => {
      const webhook = asRecord(item);

      return {
        id: requiredNumber(webhook, "id"),
        name: requiredString(webhook, "name"),
        description: optionalString(webhook, "description"),
        hookUrl: requiredString(webhook, "hookUrl"),
        allEvent: requiredBoolean(webhook, "allEvent"),
        activityTypeIds: numbers(webhook, "activityTypeIds"),
      };
    });
  },

  plan: (desired, snapshot, { manifest }) => {
    const creates: Action[] = [];
    const updates: Action[] = [];
    const kept = new Set<number>();

    for (const webhook of desired) {
      const existing = snapshot.find(({ name }) => name === webhook.name);
      const declared = changesOf(webhook, existing);
      const changes = declared;

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

      if (declared.every(({ before, after }) => sameValue(before, after))) {
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
