import { describe, expect, it } from "vitest";

import {
  duplicateName,
  listWithoutItems,
  nameHoldsBrace,
  nonBooleanSetting,
  projectDoesNotExist,
  unknownApplicableIssueType,
  unknownColor,
  unknownCustomFieldType,
  unknownInitialValueType,
  unknownTextFormattingRule,
  webhookWithoutEvents,
} from "./diagnostics";

const all = [
  projectDoesNotExist("PROJ_A"),
  duplicateName("webhooks/2/name", "webhook", "Slack 通知"),
  nameHoldsBrace("categories/0/name", "category", "緊急}対応"),
  unknownColor("issueTypes/1/color", "issue type", "バグ", "#123456"),
  unknownTextFormattingRule("html"),
  nonBooleanSetting("useWiki", "true"),
  unknownCustomFieldType("customFields/0/type", "見積もり", 99),
  unknownInitialValueType("customFields/0/initialValueType", "期限", 99),
  unknownApplicableIssueType("customFields/0/applicableIssueTypes/0", "見積もり", 99),
  webhookWithoutEvents("webhooks/0/events", "Slack 通知"),
  listWithoutItems("customFields/0/items", "環境"),
];

describe("書き出しの診断", () => {
  it("どれもスペースから読んだ実状を根拠にするエラーで、マニフェスト上の位置を持たない", () => {
    for (const diagnostic of all) {
      expect(diagnostic.severity).toBe("error");
      expect(diagnostic.stage).toBe("snapshot");
      expect(diagnostic).not.toHaveProperty("line");
      expect(diagnostic).not.toHaveProperty("column");
    }
  });

  it("ID は設計文書の決定 ID をそのまま使う", () => {
    expect(all.map(({ id }) => id)).toEqual([
      "EX-3",
      "EX-9a",
      "EX-9b",
      "EX-9c",
      "EX-9c",
      "EX-9c",
      "EX-9d",
      "EX-9d",
      "EX-9e",
      "EX-9f",
      "EX-9g",
    ]);
  });

  it("どれも直し方を添える", () => {
    for (const { hint } of all) {
      expect(hint).toBeTruthy();
    }
  });

  it("利用者が Backlog で付けた名前はそのまま埋める", () => {
    expect(duplicateName("webhooks/2/name", "webhook", "Slack 通知").message).toBe(
      'another webhook is already named "Slack 通知"',
    );
    expect(unknownColor("issueTypes/1/color", "issue type", "バグ", "#123456").message).toBe(
      'the issue type "バグ" has the color "#123456", which is not one of the ten colors this tool accepts',
    );
  });

  it("書き出されるはずだった位置を指す", () => {
    expect(webhookWithoutEvents("webhooks/0/events", "Slack 通知").path).toBe("webhooks/0/events");
  });
});
