import { describe, expect, it } from "vitest";

import { createBacklogClient } from "@backlog-blueprint/backlog-client";
import { createExport, NO_CHANGES } from "@backlog-blueprint/core";
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
    - yamada
  administrators:
    - suzuki
webhooks:
  - name: Slack 通知
    description: 課題の追加・更新を Slack に流す
    hookUrl: \${SLACK_WEBHOOK_URL}
    events:
      - issueCreated
      - issueUpdated
`;

const withoutResolvedStatus = MANIFEST.replace("  - name: 処理済み\n", "");

/** 実行者はスペース管理者なので、プロジェクト管理者にはできない（A-5） */
const withExecutorAsAdministrator = MANIFEST.replace(
  "  administrators:\n    - suzuki\n",
  "  administrators:\n    - yamada\n",
);

const withoutNarrowedCustomField = MANIFEST.replace(
  "    applicableIssueTypes:\n      - バグ\n",
  "",
);

/**
 * 実行者。スペース管理者なのでプロジェクト管理者にはなれず（A-5）、
 * プロジェクトに残すなら `access.members` に書く。
 */
const YAMADA = { id: 1, userId: "yamada", roleType: 1 };

const SUZUKI = { id: 2, userId: "suzuki", roleType: 2 };

/** 開発チームにしか属さない人。マニフェストの `access.members` には出てこない */
const TANAKA = { id: 3, userId: "tanaka", roleType: 2 };

/** どの受け入れも同じスペースから始める。違うのは投入する前提だけ */
const space = (options: MockBacklogOptions = {}): MockBacklog =>
  mockBacklog({
    executor: YAMADA,
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
    createExport,
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

const exportOf = (backlog: MockBacklog, projectKey = "PROJ_A") => {
  const { io, run } = cliOn(backlog, "", ENVIRONMENT);

  return { io, code: run(["export", projectKey, "--no-color"]) };
};

/** export は `hookUrl` を位置で採番した変数にするので、読み戻す側はその名前で値を渡す（EX-4） */
const WITH_WEBHOOK_URL = { ...ENVIRONMENT, WEBHOOK_URL_1: SLACK_WEBHOOK_URL };

const asProjectB = (yaml: string): string =>
  yaml.replace("key: PROJ_A", "key: PROJ_B").replace("name: プロジェクトA", "name: プロジェクトB");

const asProjectA = (yaml: string): string =>
  yaml.replace("key: PROJ_B", "key: PROJ_A").replace("name: プロジェクトB", "name: プロジェクトA");

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
    expect(
      project?.issueTypes.map(({ name, color, templateSummary }) => ({
        name,
        color,
        templateSummary,
      })),
    ).toEqual([
      { name: "タスク", color: "#7ea800", templateSummary: null },
      { name: "バグ", color: "#990000", templateSummary: "【不具合】" },
      { name: "調査", color: "#2779ca", templateSummary: null },
    ]);
    expect(project?.statuses.map(({ name, color }) => ({ name, color }))).toEqual([
      { name: "未対応", color: "#ed8077" },
      { name: "処理中", color: "#4488c5" },
      { name: "レビュー中", color: "#3b9dbd" },
      { name: "処理済み", color: "#5eb5a6" },
      { name: "完了", color: "#b0be3c" },
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
    expect(project?.members.map(({ userId }) => userId)).toEqual(["yamada", "suzuki"]);
    expect(project?.administrators.map(({ userId }) => userId)).toEqual(["suzuki"]);
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

  it("実行者をプロジェクト管理者にするマニフェストを apply すると、V-B11 のエラーで中断し、Backlog は一切変更されていない", async () => {
    const backlog = space();
    const { io, code } = apply(backlog, withExecutorAsAdministrator);

    await expect(code).resolves.toBe(1);
    expect(io.stderr).toContain("ERROR [V-B11]");
    expect(io.stderr).toContain("access.members");
    expect(backlog.reads.length).toBeGreaterThan(0);
    expect(backlog.writes).toEqual([]);
  });

  it("一般ユーザーの API キーで apply すると、V-B2 のエラーで中断する", async () => {
    const backlog = space({ executor: SUZUKI });
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

    await expect(planned.code).resolves.toBe(2);

    const applied = apply(space(), MANIFEST, ["--output", "json"]);

    await expect(applied.code).resolves.toBe(0);

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

    await expect(aborted.code).resolves.toBe(1);

    for (const io of [planned.io, applied.io, aborted.io]) {
      expect(io.stdout).not.toBe("");
      expect(io.stdout).not.toContain(API_KEY);
      expect(io.stderr).not.toContain(API_KEY);
    }
  });
});

describe("カスタム属性の絞り", () => {
  it("課題種別の絞りを消したマニフェストを適用するとどの課題種別でも使えるようになり、続けて plan しても差分は出ない", async () => {
    const backlog = space();

    await expect(apply(backlog, MANIFEST).code).resolves.toBe(0);
    expect(backlog.project("PROJ_A")?.customFields[0]?.applicableIssueTypes).toHaveLength(1);

    const planned = plan(backlog, withoutNarrowedCustomField);

    await expect(planned.code).resolves.toBe(2);
    expect(planned.io.stdout).toContain("applicableIssueTypes");

    await expect(apply(backlog, withoutNarrowedCustomField).code).resolves.toBe(0);

    const released = backlog.writes.filter(
      ({ method, path }) =>
        method === "PATCH" && path.startsWith("/api/v2/projects/PROJ_A/customFields/"),
    );

    expect(released).toHaveLength(1);
    expect(released[0]?.body).toContain("applicableIssueTypes%5B%5D=");
    expect(backlog.project("PROJ_A")?.customFields[0]?.applicableIssueTypes).toEqual([]);

    const replanned = plan(backlog, withoutNarrowedCustomField);

    await expect(replanned.code).resolves.toBe(0);
    expect(replanned.io.stdout).toContain(NO_CHANGES);
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

describe("export の受け入れ基準", () => {
  it("課題0件のプロジェクトを export し、案内された環境変数を設定してその出力を plan すると「差分なし」になり、終了コードが 0 になる", async () => {
    const backlog = space();

    await expect(apply(backlog, MANIFEST).code).resolves.toBe(0);

    const exported = exportOf(backlog);

    await expect(exported.code).resolves.toBe(0);
    expect(exported.io.stderr).toContain(`WEBHOOK_URL_1  "Slack 通知"`);

    const { io, run } = cliOn(backlog, exported.io.stdout, WITH_WEBHOOK_URL);

    await expect(run(["plan", "-f", "-", "--no-color"])).resolves.toBe(0);
    expect(io.stdout).toContain(NO_CHANGES);
  });

  it("課題が1件以上あるプロジェクトの export は成功し、課題件数が標準エラー出力に出る。その出力を同じプロジェクトに plan すると V-B3 で中断する", async () => {
    const backlog = space({
      projects: [{ key: "PROJ_A", name: "プロジェクトA", issueCount: 43 }],
    });
    const exported = exportOf(backlog);

    await expect(exported.code).resolves.toBe(0);
    expect(exported.io.stderr).toContain("PROJ_A holds 43 issues");

    const { io, run } = cliOn(backlog, exported.io.stdout, WITH_WEBHOOK_URL);

    await expect(run(["plan", "-f", "-", "--no-color"])).resolves.toBe(1);
    expect(io.stderr).toContain("V-B3");
  });

  it("export の標準出力と標準エラー出力のどこにも、Webhook の URL と API キーが現れない", async () => {
    const backlog = space();

    await expect(apply(backlog, MANIFEST).code).resolves.toBe(0);

    const { io, code } = exportOf(backlog);

    await expect(code).resolves.toBe(0);
    expect(io.stdout).toContain("hookUrl: ${WEBHOOK_URL_1}");
    for (const stream of [io.stdout, io.stderr]) {
      expect(stream).not.toContain(SLACK_WEBHOOK_URL);
      expect(stream).not.toContain(API_KEY);
    }
  });

  it("export した Yaml の key と name を書き換えて未作成のキーに apply し、できたプロジェクトを export すると、key と name 以外が元の出力と一致する", async () => {
    const backlog = space();

    await expect(apply(backlog, MANIFEST).code).resolves.toBe(0);

    const first = exportOf(backlog);

    await expect(first.code).resolves.toBe(0);

    const template = asProjectB(first.io.stdout);

    await expect(apply(backlog, template, [], WITH_WEBHOOK_URL).code).resolves.toBe(0);

    const second = exportOf(backlog, "PROJ_B");

    await expect(second.code).resolves.toBe(0);
    expect(asProjectA(second.io.stdout)).toBe(first.io.stdout);
  });
});
