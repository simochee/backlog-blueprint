import { describe, expect, it } from "vitest";

import { createBacklogClient } from "@backlog-blueprint/backlog-client";
import { fixedSpaceResponses } from "@backlog-blueprint/test-utils";

import { type Deps } from "./commands";
import { type Io } from "./io";
import { createOutput } from "./output";
import { buildPlan } from "./plan";
import { runCli } from "./program";

const API_KEY = "api-key-must-never-be-printed";

const MANIFEST = `key: PROJ_A
name: プロジェクトA
issueTypes:
  - name: タスク
    color: "#7ea800"
statuses:
  - name: 未対応
  - name: 処理中
  - name: レビュー中
    color: "#3b9dbd"
  - name: 処理済み
  - name: 完了
`;

type Capture = Io & { stdout: string; stderr: string };

const capturingIo = (text: string): Capture => {
  const io: Capture = {
    stdout: "",
    stderr: "",
    out: (chunk) => {
      io.stdout += chunk;
    },
    err: (chunk) => {
      io.stderr += chunk;
    },
    readStdin: () => Promise.resolve(text),
    readLine: () => Promise.resolve(""),
    isStdinTty: false,
    isStdoutTty: false,
    isStderrTty: false,
    env: { BACKLOG_API_KEY: API_KEY, BACKLOG_SPACE: "example.backlog.com" },
  };

  return io;
};

/**
 * 実 API を叩かない（開発上の禁止事項）。`fetch` そのものを差し替えることで、
 * 送信層の URL 組み立てとクエリの符号化まで含めて経路を通す。
 */
const routingFetch = (responses: Record<string, unknown>) => {
  const requested: string[] = [];

  const fetch = (url: string) => {
    const path = decodeURIComponent(url)
      .replace(/^https:\/\/[^/]+/, "")
      .replace(/\?$/, "");

    requested.push(path);

    const found = path in responses;

    return Promise.resolve({
      url,
      status: found ? 200 : 404,
      statusText: found ? "" : "Not Found",
      headers: { get: () => null },
      json: () =>
        Promise.resolve(found ? responses[path] : { errors: [{ message: "No such path." }] }),
    });
  };

  return { requested, fetch };
};

const cliWith = (text: string, responses: Record<string, unknown> = {}) => {
  const io = capturingIo(text);
  const { requested, fetch } = routingFetch(fixedSpaceResponses(responses));
  const deps: Deps = {
    io,
    output: createOutput(),
    buildPlan,
    createClient: ({ space, apiKey }) =>
      createBacklogClient({ space, apiKey, fetch: fetch as never }),
  };

  return { io, requested, run: (argv: string[]) => runCli(argv, deps) };
};

describe("validate を端から端まで", () => {
  it("正しいマニフェストは Backlog に触れずに通過する", async () => {
    const { io, requested, run } = cliWith(MANIFEST);

    await expect(run(["validate", "-f", "-"])).resolves.toBe(0);
    expect(requested).toEqual([]);
    expect(io.stdout).toBe("");
  });

  it("違反は検証 ID と直し方を添えて標準エラー出力に出る", async () => {
    const { io, run } = cliWith("key: proj a\nname: x\nissueTypes: []\n");

    await expect(run(["validate", "-f", "-"])).resolves.toBe(1);
    expect(io.stderr).toContain("ERROR [V-A3]");
    expect(io.stderr).toContain("ERROR [V-A9]");
    expect(io.stderr).toContain("→ ");
  });

  it("--output json は計画に関わる項目を持たない JSON を書く", async () => {
    const { io, run } = cliWith(MANIFEST);

    await expect(run(["validate", "-f", "-", "--output", "json"])).resolves.toBe(0);

    const json = JSON.parse(io.stdout) as Record<string, unknown>;

    expect(json["formatVersion"]).toBe(1);
    expect(json["manifest"]).toEqual({ path: "<stdin>" });
    expect(json["diagnostics"]).toEqual([]);
    expect(json).not.toHaveProperty("space");
    expect(json).not.toHaveProperty("project");
  });
});

describe("plan を端から端まで", () => {
  it("現状を取得して、起きることと更新系の件数を書く", async () => {
    const { io, requested, run } = cliWith(MANIFEST);

    await expect(run(["plan", "-f", "-", "--no-color"])).resolves.toBe(2);
    expect(requested).toContain("/api/v2/users/myself");
    expect(requested).toContain("/api/v2/issues/count?projectId[]=100");
    expect(io.stdout).toContain("Blueprint: PROJ_A (example.backlog.com)");
    expect(io.stdout).toContain('+ status         "レビュー中"');
    expect(io.stdout).toContain("Write requests:");
  });

  it("端末でない標準出力には色を混ぜない", async () => {
    const { io, run } = cliWith(MANIFEST);

    await expect(run(["plan", "-f", "-"])).resolves.toBe(2);
    expect(io.stdout).toContain('+ status         "レビュー中"');
    expect(io.stdout).not.toContain(String.fromCharCode(27));
  });

  it("--output json は標準出力に JSON だけを書く", async () => {
    const { io, run } = cliWith(MANIFEST);

    await expect(run(["plan", "-f", "-", "--output", "json"])).resolves.toBe(2);

    const json = JSON.parse(io.stdout) as Record<string, unknown>;

    expect(json["formatVersion"]).toBe(1);
    expect(json["space"]).toBe("example.backlog.com");
    expect(json["project"]).toEqual({ key: "PROJ_A", name: "プロジェクトA", exists: true });
    expect(Array.isArray(json["actions"])).toBe(true);
  });

  it("スペース管理者でない API キーは V-B2 で止まり、スナップショットを取りにいかない", async () => {
    const { io, requested, run } = cliWith(MANIFEST, {
      "/api/v2/users/myself": { id: 1, userId: "yamada", roleType: 2 },
    });

    await expect(run(["plan", "-f", "-"])).resolves.toBe(1);
    expect(requested).toEqual(["/api/v2/users/myself"]);
    expect(io.stderr).toContain("V-B2");
  });

  it("課題が残っているプロジェクトは V-B3 で止まる", async () => {
    const { io, run } = cliWith(MANIFEST, {
      "/api/v2/issues/count?projectId[]=100": { count: 43 },
    });

    await expect(run(["plan", "-f", "-"])).resolves.toBe(1);
    expect(io.stderr).toContain("V-B3");
    expect(io.stderr).toContain("43");
  });

  it("出力のどこにも API キーが現れない", async () => {
    const { io, run } = cliWith(MANIFEST);

    await run(["plan", "-f", "-", "--output", "json"]);

    expect(io.stdout).not.toContain(API_KEY);
    expect(io.stderr).not.toContain(API_KEY);
  });
});
