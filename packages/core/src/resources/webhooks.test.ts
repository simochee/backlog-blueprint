import { describe, expect, it } from "vitest";

import { fixedPlanContext, fixedReadContext, fixedSnapshot } from "../../../test-utils/src/index";
import { Secret } from "../secret";
import { WEBHOOK_EVENTS } from "../webhook-events";
import { webhooksReconciler, type DesiredWebhook, type WebhooksSnapshot } from "./webhooks";

const plan = (desired: DesiredWebhook[], snapshot: WebhooksSnapshot) =>
  webhooksReconciler.plan(desired, snapshot, fixedPlanContext());

const slack: WebhooksSnapshot[number] = {
  id: 41,
  name: "Slack 通知",
  hookUrl: "https://hooks.example.test/T0/B0",
  allEvent: false,
  activityTypeIds: [1, 2],
};

describe("Webhook の現状取得", () => {
  it("Webhook は通知イベントの指定ごと取得する", async () => {
    const snapshot = await webhooksReconciler.read(
      fixedReadContext({
        "/api/v2/projects/PROJ_A/webhooks": [
          {
            id: 41,
            name: "Slack 通知",
            description: "課題の追加・更新を Slack に流す",
            hookUrl: "https://hooks.example.test/T0/B0",
            allEvent: false,
            activityTypeIds: [1, 2],
          },
        ],
      }),
    );

    expect(snapshot).toEqual([
      {
        id: 41,
        name: "Slack 通知",
        description: "課題の追加・更新を Slack に流す",
        hookUrl: "https://hooks.example.test/T0/B0",
        allEvent: false,
        activityTypeIds: [1, 2],
      },
    ]);
  });

  it("プロジェクトが未作成なら取得を行わず、空のスナップショットになる", async () => {
    const snapshot = await webhooksReconciler.read(
      fixedReadContext({}, { snapshot: fixedSnapshot({ project: { exists: false } }) }),
    );

    expect(snapshot).toEqual([]);
  });
});

describe("Webhook の通知イベント", () => {
  it("イベント名は数値に解決されて送られる", () => {
    const [action] = plan(
      [
        {
          name: "Slack 通知",
          hookUrl: "https://hooks.example.test/T0/B0",
          events: ["issueCreated", "issueUpdated"],
        },
      ],
      [],
    );

    expect(action?.request?.params).toEqual({
      name: "Slack 通知",
      hookUrl: "https://hooks.example.test/T0/B0",
      allEvent: false,
      activityTypeIds: [1, 2],
    });
  });

  it("同じイベントを名前と数値で書いても差分にならない", () => {
    const actions = plan(
      [
        {
          name: "Slack 通知",
          hookUrl: slack.hookUrl,
          events: ["issueCreated", 2],
        },
      ],
      [slack],
    );

    expect(actions.map(({ op }) => op)).toEqual(["noop"]);
  });

  it("イベントの並び順が違っても差分にならない", () => {
    const actions = plan(
      [{ name: "Slack 通知", hookUrl: slack.hookUrl, events: ["issueUpdated", "issueCreated"] }],
      [slack],
    );

    expect(actions.map(({ op }) => op)).toEqual(["noop"]);
  });

  it("イベントが増えれば更新される", () => {
    const actions = plan(
      [
        {
          name: "Slack 通知",
          hookUrl: slack.hookUrl,
          events: ["issueCreated", "issueUpdated", "issueCommented"],
        },
      ],
      [slack],
    );

    expect(actions).toEqual([
      {
        id: "webhooks/update/Slack 通知",
        phase: 8,
        kind: "webhook",
        op: "update",
        name: "Slack 通知",
        target: 41,
        request: {
          method: "PATCH",
          path: "/api/v2/projects/PROJ_A/webhooks/41",
          params: {
            name: "Slack 通知",
            hookUrl: slack.hookUrl,
            allEvent: false,
            activityTypeIds: [1, 2, 3],
          },
        },
        changes: [
          { field: "name", before: "Slack 通知", after: "Slack 通知" },
          { field: "hookUrl", before: slack.hookUrl, after: slack.hookUrl },
          { field: "events", before: [1, 2], after: [1, 2, 3] },
        ],
        writeRequest: true,
      },
    ]);
  });

  it("CLI が知らないイベントは数値のまま送られる", () => {
    const [action] = plan(
      [{ name: "監査ログ", hookUrl: "https://audit.example.test", events: [50] }],
      [],
    );

    expect(action?.request?.params.activityTypeIds).toEqual([50]);
  });

  it("events: all は全イベントを通知する指定として送られる", () => {
    const [action] = plan(
      [{ name: "監査ログ", hookUrl: "https://audit.example.test", events: "all" }],
      [],
    );

    expect(action?.request?.params).toEqual({
      name: "監査ログ",
      hookUrl: "https://audit.example.test",
      allEvent: true,
    });
  });

  it("events: all と全イベントの列挙は別物として扱う", () => {
    const everyEvent = WEBHOOK_EVENTS.map(({ name }) => name);
    const audit: WebhooksSnapshot[number] = {
      id: 42,
      name: "監査ログ",
      hookUrl: "https://audit.example.test",
      allEvent: true,
      activityTypeIds: [],
    };

    const actions = plan(
      [{ name: "監査ログ", hookUrl: audit.hookUrl, events: [...everyEvent] }],
      [audit],
    );

    expect(actions.map(({ op }) => op)).toEqual(["update"]);
    expect(actions[0]?.request?.params.allEvent).toBe(false);
  });

  it("events: all のままなら差分にならない", () => {
    const audit: WebhooksSnapshot[number] = {
      id: 42,
      name: "監査ログ",
      hookUrl: "https://audit.example.test",
      allEvent: true,
      activityTypeIds: [],
    };

    const actions = plan([{ name: "監査ログ", hookUrl: audit.hookUrl, events: "all" }], [audit]);

    expect(actions.map(({ op }) => op)).toEqual(["noop"]);
  });
});

describe("Webhook の hookUrl", () => {
  it("環境変数から展開した hookUrl は実値で突き合わせる", () => {
    const actions = plan(
      [{ name: "Slack 通知", hookUrl: new Secret(slack.hookUrl), events: [1, 2] }],
      [slack],
    );

    expect(actions.map(({ op }) => op)).toEqual(["noop"]);
  });

  it("環境変数から展開した hookUrl が違えば更新される", () => {
    const actions = plan(
      [
        {
          name: "Slack 通知",
          hookUrl: new Secret("https://hooks.example.test/T1/B1"),
          events: [1, 2],
        },
      ],
      [slack],
    );

    expect(actions.map(({ op }) => op)).toEqual(["update"]);
  });

  it("環境変数から展開した hookUrl は出力に実値が現れない", () => {
    const [action] = plan(
      [
        {
          name: "Slack 通知",
          hookUrl: new Secret("https://hooks.example.test/T1/B1"),
          events: [1, 2],
        },
      ],
      [slack],
    );

    expect(JSON.stringify(action)).not.toContain("T1/B1");
    expect(JSON.stringify(action)).toContain(String.raw`"hookUrl":"***"`);
  });
});

describe("Webhook の差分", () => {
  it("存在しない Webhook は作成される", () => {
    const actions = plan(
      [
        {
          name: "Slack 通知",
          description: "課題の追加・更新を Slack に流す",
          hookUrl: "https://hooks.example.test/T0/B0",
          events: ["issueCreated"],
        },
      ],
      [],
    );

    expect(actions).toEqual([
      {
        id: "webhooks/create/Slack 通知",
        phase: 8,
        kind: "webhook",
        op: "create",
        name: "Slack 通知",
        request: {
          method: "POST",
          path: "/api/v2/projects/PROJ_A/webhooks",
          params: {
            name: "Slack 通知",
            description: "課題の追加・更新を Slack に流す",
            hookUrl: "https://hooks.example.test/T0/B0",
            allEvent: false,
            activityTypeIds: [1],
          },
        },
        provides: [{ kind: "webhook", name: "Slack 通知" }],
        changes: [
          { field: "name", before: null, after: "Slack 通知" },
          { field: "description", before: null, after: "課題の追加・更新を Slack に流す" },
          { field: "hookUrl", before: null, after: "https://hooks.example.test/T0/B0" },
          { field: "events", before: null, after: [1] },
        ],
        writeRequest: true,
      },
    ]);
  });

  it("マニフェストに無い既存 Webhook は削除される", () => {
    expect(plan([], [slack])).toEqual([
      {
        id: "webhooks/delete/Slack 通知",
        phase: 8,
        kind: "webhook",
        op: "delete",
        name: "Slack 通知",
        target: 41,
        request: {
          method: "DELETE",
          path: "/api/v2/projects/PROJ_A/webhooks/41",
          params: {},
        },
        writeRequest: true,
      },
    ]);
  });

  it("Webhook には oldname が無いので、名前を変えると作成と削除になる", () => {
    const actions = plan(
      [{ name: "Slack 通知 v2", hookUrl: slack.hookUrl, events: [1, 2] }],
      [slack],
    );

    expect(actions.map(({ op, name }) => [op, name])).toEqual([
      ["create", "Slack 通知 v2"],
      ["delete", "Slack 通知"],
    ]);
  });

  it("適用済みのマニフェストをもう一度計画しても更新リクエストは出ない", () => {
    const desired: DesiredWebhook[] = [
      {
        name: "Slack 通知",
        hookUrl: new Secret(slack.hookUrl),
        events: ["issueCreated", "issueUpdated"],
      },
    ];

    const actions = plan(desired, [slack]);

    expect(actions.every(({ writeRequest }) => !writeRequest)).toBe(true);
  });
});
