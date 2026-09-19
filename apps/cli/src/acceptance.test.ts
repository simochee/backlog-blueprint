import { describe, expect, it } from "vitest";

import { createBacklogClient } from "@backlog-blueprint/backlog-client";
import { NO_CHANGES } from "@backlog-blueprint/core";
import {
  mockBacklog,
  withoutWritePacing,
  type MockBacklog,
  type MockBacklogOptions,
} from "@backlog-blueprint/test-utils";

import { type Deps } from "./commands";
import { type Io } from "./io";
import { createOutput } from "./output";
import { buildPlan } from "./plan";
import { runCli } from "./program";

const API_KEY = "api-key-must-never-be-printed";

const SPACE = "example.backlog.com";

const SLACK_WEBHOOK_URL = "https://hooks.example.test/T000/B000";

const MANIFEST = `key: PROJ_A
name: プロジェクトA
settings:
  textFormattingRule: markdown
  chartEnabled: true
  useWiki: true
issueTypes:
  - name: タスク
    color: "#7ea800"
  - name: バグ
    color: "#990000"
    templateSummary: "【不具合】"
  - name: 調査
    color: "#2779ca"
statuses:
  - name: 未対応
  - name: 処理中
  - name: レビュー中
    color: "#3b9dbd"
  - name: 処理済み
  - name: 完了
categories:
  - name: フロントエンド
  - name: バックエンド
milestones:
  - name: v1.0.0
    description: 初回リリース
    startDate: "2026-10-01"
    releaseDueDate: "2026-12-31"
customFields:
  - name: 影響範囲
    type: singleList
    required: true
    applicableIssueTypes:
      - バグ
    items:
      - 軽微
      - 重大
  - name: 見積工数
    type: number
    unit: 人日
    min: 0
access:
  teams:
    - 開発チーム
  members:
    - suzuki
  administrators:
    - yamada
webhooks:
  - name: Slack 通知
    description: 課題の追加・更新を Slack に流す
    hookUrl: \${SLACK_WEBHOOK_URL}
    events:
      - issueCreated
      - issueUpdated
`;

const withoutResolvedStatus = MANIFEST.replace("  - name: 処理済み\n", "");

const YAMADA = { id: 1, userId: "yamada" };

const SUZUKI = { id: 2, userId: "suzuki" };

/** 開発チームにしか属さない人。マニフェストの `access.members` には出てこない */
const TANAKA = { id: 3, userId: "tanaka" };

/** どの受け入れも同じスペースから始める。違うのは投入する前提だけ */
const space = (options: MockBacklogOptions = {}): MockBacklog =>
  mockBacklog({
    executor: { ...YAMADA, roleType: 1 },
    spaceUsers: [YAMADA, SUZUKI, TANAKA],
    spaceTeams: [{ name: "開発チーム", members: ["tanaka"] }],
    ...options,
  });

type Capture = Io & { stdout: string; stderr: string };

const capturingIo = (manifest: string, env: Record<string, string | undefined>): Capture => {
  const io: Capture = {
    stdout: "",
    stderr: "",
    out: (chunk) => {
      io.stdout += chunk;
    },
    err: (chunk) => {
      io.stderr += chunk;
    },
    readStdin: () => Promise.resolve(manifest),
    readLine: () => Promise.resolve(""),
    isStdinTty: false,
    isStdoutTty: false,
    isStderrTty: false,
    env,
  };

  return io;
};

const ENVIRONMENT = {
  BACKLOG_API_KEY: API_KEY,
  BACKLOG_SPACE: SPACE,
  SLACK_WEBHOOK_URL,
};

/**
 * 実 API を叩かない（開発上の禁止事項）。`fetch` そのものを差し替えるので、
 * 送信層の URL 組み立てと本文の符号化まで含めて経路が通る。
 */
const cliOn = (
  backlog: MockBacklog,
  manifest: string,
  env: Record<string, string | undefined> = ENVIRONMENT,
) => {
  const io = capturingIo(manifest, env);
  const deps: Deps = {
    io,
    output: createOutput(),
    buildPlan,
    createClient: ({ space: domain, apiKey }) =>
      createBacklogClient({ space: domain, apiKey, fetch: backlog.fetch as never }),
  };

  return { io, run: (argv: string[]) => runCli(argv, deps) };
};

const plan = (backlog: MockBacklog, manifest: string, argv: string[] = []) => {
  const { io, run } = cliOn(backlog, manifest);

  return { io, code: run(["plan", "-f", "-", "--no-color", ...argv]) };
};

const apply = (
  backlog: MockBacklog,
  manifest: string,
  argv: string[] = [],
  env: Record<string, string | undefined> = ENVIRONMENT,
) => {
  const { io, run } = cliOn(backlog, manifest, env);

  return {
    io,
    code: withoutWritePacing(() => run(["apply", "-f", "-", "--auto-approve", ...argv])),
  };
};

const json = (text: string): Record<string, unknown> => JSON.parse(text) as Record<string, unknown>;

type ActionSummary = { id: string; op: string; writeRequest: boolean };

const actionsOf = (report: Record<string, unknown>): ActionSummary[] =>
  report["actions"] as ActionSummary[];

describe("受け入れ基準", () => {
  it("存在しないプロジェクトキーのマニフェストを apply すると、プロジェクトが作成され、課題種別・ステータス・カテゴリー・マイルストーン・カスタム属性・メンバー・Webhook が定義通りになっている", async () => {
    const backlog = space();

    await expect(apply(backlog, MANIFEST, ["--no-color"]).code).resolves.toBe(0);

    const project = backlog.project("PROJ_A");

    expect(project?.name).toBe("プロジェクトA");
    expect(project?.settings).toMatchObject({
      textFormattingRule: "markdown",
      chartEnabled: true,
      useWiki: true,
    });
    expect(project?.issueTypes.map(({ name, color }) => ({ name, color }))).toEqual([
      { name: "タスク", color: "#7ea800" },
      { name: "バグ", color: "#990000" },
      { name: "調査", color: "#2779ca" },
    ]);
    expect(project?.statuses.map(({ name }) => name)).toEqual([
      "未対応",
      "処理中",
      "レビュー中",
      "処理済み",
      "完了",
    ]);
    expect(project?.categories.map(({ name }) => name)).toEqual(["フロントエンド", "バックエンド"]);
    expect(project?.milestones).toEqual([
      {
        id: expect.any(Number),
        name: "v1.0.0",
        description: "初回リリース",
        startDate: "2026-10-01T00:00:00Z",
        releaseDueDate: "2026-12-31T00:00:00Z",
      },
    ]);

    const バグ = project?.issueTypes.find(({ name }) => name === "バグ");

    expect(
      project?.customFields.map(
        ({ name, typeId, required, unit, min, items, applicableIssueTypes }) => ({
          name,
          typeId,
          required,
          unit,
          min,
          items: items?.map((item) => item.name) ?? null,
          applicableIssueTypes,
        }),
      ),
    ).toEqual([
      {
        name: "影響範囲",
        typeId: 5,
        required: true,
        unit: null,
        min: null,
        items: ["軽微", "重大"],
        applicableIssueTypes: [バグ?.id],
      },
      {
        name: "見積工数",
        typeId: 3,
        required: false,
        unit: "人日",
        min: 0,
        items: null,
        applicableIssueTypes: [],
      },
    ]);
    expect(project?.teams.map(({ name }) => name)).toEqual(["開発チーム"]);
    expect(project?.members.map(({ userId }) => userId)).toEqual(["suzuki", "yamada"]);
    expect(project?.administrators.map(({ userId }) => userId)).toEqual(["yamada"]);
    expect(project?.webhooks).toEqual([
      {
        id: expect.any(Number),
        name: "Slack 通知",
        description: "課題の追加・更新を Slack に流す",
        hookUrl: SLACK_WEBHOOK_URL,
        allEvent: false,
        activityTypeIds: [1, 2],
      },
    ]);
  });

  it("初期状態の課題種別（タスク/バグ/要望/その他）が定義に無ければ、適用後に残っていない", async () => {
    const backlog = space();

    await expect(apply(backlog, MANIFEST).code).resolves.toBe(0);

    expect(backlog.project("PROJ_A")?.issueTypes.map(({ name }) => name)).not.toContain("要望");
    expect(backlog.project("PROJ_A")?.issueTypes.map(({ name }) => name)).not.toContain("その他");
  });

  it("既定ステータスを1つ省いたマニフェストを plan すると、V-A6 のエラーで中断し、Backlog は一切変更されていない", async () => {
    const backlog = space();
    const { io, code } = plan(backlog, withoutResolvedStatus);

    await expect(code).resolves.toBe(1);
    expect(io.stderr).toContain("ERROR [V-A6]");
    expect(backlog.reads.length).toBeGreaterThan(0);
    expect(backlog.writes).toEqual([]);
  });

  it("課題が1件あるプロジェクトに apply すると、V-B3 のエラーで中断し、Backlog は一切変更されていない", async () => {
    const backlog = space({
      projects: [{ key: "PROJ_A", name: "プロジェクトA", issueCount: 1 }],
    });
    const { io, code } = apply(backlog, MANIFEST);

    await expect(code).resolves.toBe(1);
    expect(io.stderr).toContain("ERROR [V-B3]");
    expect(backlog.reads.length).toBeGreaterThan(0);
    expect(backlog.writes).toEqual([]);
  });

  it("一般ユーザーの API キーで apply すると、V-B2 のエラーで中断する", async () => {
    const backlog = space({ executor: { ...SUZUKI, roleType: 2 } });
    const { io, code } = apply(backlog, MANIFEST);

    await expect(code).resolves.toBe(1);
    expect(io.stderr).toContain("ERROR [V-B2]");
    expect(backlog.reads).toHaveLength(1);
    expect(backlog.writes).toEqual([]);
  });

  it("plan は Backlog を変更しない。plan の直後に同じ内容の plan を実行しても結果が同じ", async () => {
    const backlog = space();
    const first = plan(backlog, MANIFEST);

    await expect(first.code).resolves.toBe(2);

    const second = plan(backlog, MANIFEST);

    await expect(second.code).resolves.toBe(2);
    expect(second.io.stdout).toBe(first.io.stdout);
    expect(backlog.writes).toEqual([]);
  });

  it("apply の途中で API エラーが起きると、そこで停止し、適用済み／未適用の一覧が出力される", async () => {
    const backlog = space({
      failures: [
        {
          method: "POST",
          path: "/api/v2/projects/PROJ_A/categories",
          status: 400,
          message: "Something went wrong.",
        },
      ],
    });
    const { io, code } = apply(backlog, MANIFEST, ["--no-color"]);

    await expect(code).resolves.toBe(1);
    expect(io.stdout).toContain("ERROR  POST /api/v2/projects/PROJ_A/categories");
    expect(io.stdout).toContain("400  Something went wrong.");
    expect(io.stdout).toContain("Apply aborted. Nothing has been rolled back.");
    expect(io.stdout).toContain("Applied (8):");
    expect(io.stdout).toContain("Failed (1):");
    expect(io.stdout).toContain("Not applied (9):");
    expect(io.stdout).toContain(
      "Re-run apply with the same manifest to continue. Already applied changes become no-ops.",
    );
    expect(io.stdout).toContain("The project must still have zero issues at that point.");
    expect(backlog.project("PROJ_A")?.categories).toEqual([]);
    expect(backlog.project("PROJ_A")?.webhooks).toEqual([]);
  });

  it("apply 成功後に同じマニフェストを plan すると「差分なし」になり、終了コードが 0 になる", async () => {
    const backlog = space();

    await expect(apply(backlog, MANIFEST).code).resolves.toBe(0);

    const { io, code } = plan(backlog, MANIFEST);

    await expect(code).resolves.toBe(0);
    expect(io.stdout).toContain(NO_CHANGES);
  });

  it("${SLACK_WEBHOOK_URL} を含むマニフェストで、環境変数が未定義なら V-A4 のエラーになる", async () => {
    const backlog = space();
    const { io, run } = cliOn(backlog, MANIFEST, {
      BACKLOG_API_KEY: API_KEY,
      BACKLOG_SPACE: SPACE,
    });

    await expect(run(["plan", "-f", "-", "--no-color"])).resolves.toBe(1);
    expect(io.stderr).toContain("ERROR [V-A4]");
    expect(io.stderr).toContain("SLACK_WEBHOOK_URL");
  });

  it("plan / apply の出力とログのどこにも API キーが現れない", async () => {
    const planned = plan(space(), MANIFEST, ["--output", "json"]);

    await planned.code;

    const applied = apply(space(), MANIFEST, ["--output", "json"]);

    await applied.code;

    const aborted = apply(
      space({
        failures: [
          {
            method: "POST",
            path: "/api/v2/projects/PROJ_A/categories",
            status: 401,
            message: "Authentication failure.",
          },
        ],
      }),
      MANIFEST,
    );

    await aborted.code;

    for (const io of [planned.io, applied.io, aborted.io]) {
      expect(io.stdout).not.toContain(API_KEY);
      expect(io.stderr).not.toContain(API_KEY);
    }
  });
});

describe("plan と apply は同じ Action[] を見る", () => {
  it("同じマニフェストと同じスナップショットに対して、plan が描いた Action と apply が実行した Action が一致する", async () => {
    const planned = plan(space(), MANIFEST, ["--output", "json"]);

    await expect(planned.code).resolves.toBe(2);

    const executed = space();
    const applied = apply(executed, MANIFEST, ["--output", "json"]);

    await expect(applied.code).resolves.toBe(0);

    const before = json(planned.io.stdout);
    const after = json(applied.io.stdout);

    expect(actionsOf(after)).toEqual(actionsOf(before));
    expect(after["applied"]).toEqual(
      actionsOf(before)
        .filter(({ op }) => op !== "noop")
        .map(({ id }) => id),
    );
    expect(after["pending"]).toEqual([]);
  });

  it("apply が送った更新系は、plan が更新系だと書いた Action と同じ件数しかない", async () => {
    const backlog = space();
    const applied = apply(backlog, MANIFEST, ["--output", "json"]);

    await expect(applied.code).resolves.toBe(0);

    const report = json(applied.io.stdout);
    const writes = actionsOf(report).filter(({ writeRequest }) => writeRequest);

    expect(backlog.writes).toHaveLength(writes.length);
    expect(writes.length).toBeGreaterThan(0);
  });
});
