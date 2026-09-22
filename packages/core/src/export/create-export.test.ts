import { describe, expect, it } from "vitest";

import { fixedSpaceResponses, httpFailure, recordingGet } from "../../../test-utils/src/index";
import { createExport } from "./create-export";

const VERSION = "1.2.3";

/**
 * 課題種別が0件のスペースは V-A9 を通らないので、`fixedSpaceResponses` の既定に
 * 1件足したところを出発点にする。
 */
const ISSUE_TYPES = [{ id: 10, name: "タスク", color: "#7ea800" }];

const exportProject = async (responses: Record<string, unknown> = {}) => {
  const { get, requested } = recordingGet(
    fixedSpaceResponses({ "/api/v2/projects/PROJ_A/issueTypes": ISSUE_TYPES, ...responses }),
  );
  const result = await createExport({ projectKey: "PROJ_A", get, version: VERSION });

  return { ...result, requested, ids: result.diagnostics.map(({ id }) => id) };
};

describe("プロジェクトの書き出し", () => {
  it("大文字・数字・アンダースコア以外を含むキーは V-A3 で止まり、Backlog を1回も読まない", async () => {
    const { get, requested } = recordingGet(fixedSpaceResponses({}));
    const { diagnostics, exported } = await createExport({
      projectKey: "proj_a",
      get,
      version: VERSION,
    });

    expect(diagnostics.map(({ id }) => id)).toEqual(["V-A3"]);
    expect(exported).toBeUndefined();
    expect(requested).toEqual([]);
  });

  it("スペース管理者でなければスナップショットの取得を始めない", async () => {
    const { ids, exported, requested } = await exportProject({
      "/api/v2/users/myself": { id: 2, userId: "sato", roleType: 2 },
    });

    expect(ids).toEqual(["V-B2"]);
    expect(exported).toBeUndefined();
    expect(requested).toEqual(["/api/v2/users/myself"]);
  });

  it("プロジェクトが存在しなければ EX-3 で止まり、リソースは1つも読まない", async () => {
    const { ids, exported, requested } = await exportProject({
      "/api/v2/projects/PROJ_A": httpFailure({ status: 404, errors: [{ message: "No project." }] }),
    });

    expect(ids).toEqual(["EX-3"]);
    expect(exported).toBeUndefined();
    expect(requested).toEqual(["/api/v2/users/myself", "/api/v2/projects/PROJ_A"]);
  });

  it("課題件数を読めなければ、V-B3 の診断ではなく例外として呼び出し側へ届く", async () => {
    await expect(
      exportProject({
        "/api/v2/issues/count?projectId[]=100": httpFailure({
          status: 403,
          errors: [{ message: "No permission." }],
        }),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("課題を持つプロジェクトも書き出せる", async () => {
    const { ids, exported } = await exportProject({
      "/api/v2/issues/count?projectId[]=100": { count: 43 },
    });

    expect(ids).toEqual([]);
    expect(exported?.issueCount).toBe(43);
    expect(exported?.manifest.key).toBe("PROJ_A");
  });

  it("書き出した Yaml は先頭にスキーマの URL を、続けてマニフェストを持つ", async () => {
    const { exported } = await exportProject();

    expect(exported?.yaml.split("\n").slice(0, 2)).toEqual([
      `# yaml-language-server: $schema=https://simochee.github.io/backlog-blueprint/schema/${VERSION}/project.json`,
      "key: PROJ_A",
    ]);
  });

  it("Webhook の URL を取得値のまま書き出す", async () => {
    const { exported } = await exportProject({
      "/api/v2/projects/PROJ_A/webhooks": [
        {
          id: 1,
          name: "Slack 通知",
          hookUrl: "https://example.test/hooks/value",
          allEvent: true,
          activityTypeIds: [],
        },
      ],
    });

    expect(exported?.yaml).toContain("hookUrl: https://example.test/hooks/value");
  });

  it("マニフェストとして書けない実状があれば、Yaml を1バイトも返さない", async () => {
    const { ids, exported } = await exportProject({
      "/api/v2/projects/PROJ_A/issueTypes": [
        { id: 10, name: "タスク", color: "#7ea800" },
        { id: 11, name: "タスク", color: "#123456" },
      ],
    });

    expect(ids).toEqual(["EX-9a", "EX-9c"]);
    expect(exported).toBeUndefined();
  });
});
