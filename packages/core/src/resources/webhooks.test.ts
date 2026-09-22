import { describe, expect, it } from "vitest";

import { fixedPlanContext, fixedReadContext, fixedSnapshot } from "../../../test-utils/src/index";
import { type Webhook } from "../manifest";
import { WEBHOOK_EVENTS } from "../webhook-events";
import { webhooksReconciler, type WebhooksSnapshot } from "./webhooks";

const plan = (desired: Webhook[], snapshot: WebhooksSnapshot) =>
  webhooksReconciler.plan(desired, snapshot, fixedPlanContext());

const SLACK_URL = "https://hooks.example.test/T0/B0";

const slack: WebhooksSnapshot[number] = {
  id: 41,
  name: "Slack 通知",
  hookUrl: SLACK_URL,
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
            hookUrl: SLACK_URL,
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
        hookUrl: SLACK_URL,
        allEvent: false,
        activityTypeIds: [1, 2],
      },
    ]);
  });

  it("登録済みの hookUrl は取得値のまま保持する", () => {
    expect(slack.hookUrl).toBe(SLACK_URL);
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
          hookUrl: SLACK_URL,
          events: ["issueCreated", "issueUpdated"],
        },
      ],
      [],
    );

    expect(action?.request?.params).toEqual({
      name: "Slack 通知",
      hookUrl: SLACK_URL,
      allEvent: false,
      activityTypeIds: [1, 2],
    });
  });

  it("同じイベントを名前と数値で書いても差分にならない", () => {
    const actions = plan(
      [{ name: "Slack 通知", hookUrl: SLACK_URL, events: ["issueCreated", 2] }],
      [slack],
    );

    expect(actions.map(({ op }) => op)).toEqual(["noop"]);
  });

  it("イベントの並び順が違っても差分にならない", () => {
    const actions = plan(
      [{ name: "Slack 通知", hookUrl: SLACK_URL, events: ["issueUpdated", "issueCreated"] }],
      [slack],
    );

    expect(actions.map(({ op }) => op)).toEqual(["noop"]);
  });

  it("イベントが増えれば更新される", () => {
    const [action] = plan(
      [
        {
          name: "Slack 通知",
          hookUrl: SLACK_URL,
          events: ["issueCreated", "issueUpdated", "issueCommented"],
        },
      ],
      [slack],
    );

    expect(action?.op).toBe("update");
    expect(action?.target).toBe(41);
    expect(action?.request?.path).toBe("/api/v2/projects/PROJ_A/webhooks/41");
    expect(action?.request?.params.activityTypeIds).toEqual([1, 2, 3]);
    expect(action?.changes?.map(({ field, before, after }) => [field, before, after])).toEqual([
      ["name", "Slack 通知", "Slack 通知"],
      ["hookUrl", SLACK_URL, SLACK_URL],
      ["events", [1, 2], [1, 2, 3]],
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
      [{ name: "監査ログ", hookUrl: "https://audit.example.test", events: [...everyEvent] }],
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

    const actions = plan(
      [{ name: "監査ログ", hookUrl: "https://audit.example.test", events: "all" }],
      [audit],
    );

    expect(actions.map(({ op }) => op)).toEqual(["noop"]);
  });
});

describe("Webhook の hookUrl", () => {
  it("環境変数から展開した hookUrl は実値で突き合わせる", () => {
    const actions = plan([{ name: "Slack 通知", hookUrl: SLACK_URL, events: [1, 2] }], [slack]);

    expect(actions.map(({ op }) => op)).toEqual(["noop"]);
  });

  it("環境変数から展開した hookUrl が違えば更新される", () => {
    const actions = plan(
      [{ name: "Slack 通知", hookUrl: "https://hooks.example.test/T1/B1", events: [1, 2] }],
      [slack],
    );

    expect(actions.map(({ op }) => op)).toEqual(["update"]);
  });

  it("環境変数から展開した hookUrl は出力に実値が現れる", () => {
    const [action] = plan(
      [{ name: "Slack 通知", hookUrl: "https://hooks.example.test/T1/B1", events: [1, 2] }],
      [slack],
    );

    expect(action?.request?.params.hookUrl).toBe("https://hooks.example.test/T1/B1");
  });

  it("Yaml に直接書かれた hookUrl もそのまま出る", () => {
    const [action] = plan(
      [{ name: "Slack 通知", hookUrl: "https://hooks.example.test/T1/B1", events: [1, 2] }],
      [slack],
    );

    expect(action?.request?.params.hookUrl).toBe("https://hooks.example.test/T1/B1");
  });

  it("環境変数から展開した description もそのまま出る", () => {
    const [action] = plan(
      [
        {
          name: "Slack 通知",
          description: "秘密の説明",
          hookUrl: SLACK_URL,
          events: [1, 2],
        },
      ],
      [],
    );

    expect(action?.request?.params.description).toBe("秘密の説明");
  });

  it("Webhook 名はマニフェストに指定するとリクエストにも差分にも平文で出る", () => {
    const [action] = plan([{ name: "社外秘の Webhook", hookUrl: SLACK_URL, events: [1, 2] }], []);

    expect(action?.request?.params.name).toBe("社外秘の Webhook");
    expect(action?.changes).toContainEqual({
      field: "name",
      before: null,
      after: "社外秘の Webhook",
    });
    expect(action?.id).toBe("webhooks/create/社外秘の Webhook");
  });
});

describe("Webhook の差分", () => {
  it("存在しない Webhook は作成される", () => {
    const actions = plan(
      [
        {
          name: "Slack 通知",
          description: "課題の追加・更新を Slack に流す",
          hookUrl: SLACK_URL,
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
            hookUrl: SLACK_URL,
            allEvent: false,
            activityTypeIds: [1],
          },
        },
        provides: [{ kind: "webhook", name: "Slack 通知" }],
        changes: [
          { field: "name", before: null, after: "Slack 通知" },
          { field: "description", before: null, after: "課題の追加・更新を Slack に流す" },
          { field: "hookUrl", before: null, after: SLACK_URL },
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
    const actions = plan([{ name: "Slack 通知 v2", hookUrl: SLACK_URL, events: [1, 2] }], [slack]);

    expect(actions.map(({ op, name }) => [op, name])).toEqual([
      ["create", "Slack 通知 v2"],
      ["delete", "Slack 通知"],
    ]);
  });

  it("適用済みのマニフェストをもう一度計画しても更新リクエストは出ない", () => {
    const desired: Webhook[] = [
      { name: "Slack 通知", hookUrl: SLACK_URL, events: ["issueCreated", "issueUpdated"] },
    ];

    const actions = plan(desired, [slack]);

    expect(actions.every(({ writeRequest }) => !writeRequest)).toBe(true);
  });
});
