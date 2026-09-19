import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { type BacklogClient } from "@backlog-blueprint/backlog-client";
import { type Action, type Diagnostic } from "@backlog-blueprint/core";

import { type Deps } from "./commands";
import { type Io } from "./io";
import { type Output, type PlanResult } from "./ports";
import { runCli } from "./program";

const API_KEY = "api-key-must-never-be-printed";

const ISSUE_TYPES = 'issueTypes:\n  - name: タスク\n    color: "#7ea800"\n';

const MANIFEST = `key: PROJ_A\nname: プロジェクトA\n${ISSUE_TYPES}`;

type Capture = { stdout: string; stderr: string };

type FakeIo = Io & Capture;

const fakeIo = (
  overrides: { stdin?: string; answers?: string[]; isStdinTty?: boolean; env?: Io["env"] } = {},
): FakeIo => {
  const answers = [...(overrides.answers ?? [])];
  const io: FakeIo = {
    stdout: "",
    stderr: "",
    out: (text) => {
      io.stdout += text;
    },
    err: (text) => {
      io.stderr += text;
    },
    readStdin: () => Promise.resolve(overrides.stdin ?? MANIFEST),
    readLine: () => Promise.resolve(answers.shift() ?? ""),
    isStdinTty: overrides.isStdinTty ?? true,
    env: overrides.env ?? { BACKLOG_API_KEY: API_KEY, BACKLOG_SPACE: "example.backlog.com" },
  };

  return io;
};

const anAction = (overrides: Partial<Action> = {}): Action => ({
  id: "milestones/create/v1",
  phase: 5,
  kind: "milestone",
  op: "create",
  name: "v1",
  request: { method: "POST", path: "/api/v2/projects/PROJ_A/versions", params: { name: "v1" } },
  writeRequest: true,
  ...overrides,
});

const fakeOutput: Output = {
  diagnostics: (diagnostics, { color }) =>
    `diagnostics(color=${color}) ${diagnostics.map(({ id, severity }) => `${id}:${severity}`).join(",")}\n`,
  validateJson: ({ diagnostics }) => `${JSON.stringify({ diagnostics: diagnostics.length })}\n`,
  plan: (_input, { color, showUnchanged }) =>
    `plan-body(color=${color},showUnchanged=${showUnchanged})\n`,
  planJson: ({ plan }) => `${JSON.stringify({ actions: plan.actions.length })}\n`,
  progress: (event) => `progress:${event.type}\n`,
  applyResult: ({ outcome }) => `apply-result:${outcome.result}\n`,
  applyJson: ({ outcome }) => `${JSON.stringify({ result: outcome.result })}\n`,
};

const fakePlan = (overrides: Partial<PlanResult> = {}): PlanResult => ({
  project: { key: "PROJ_A", name: "プロジェクトA", exists: false },
  diagnostics: [],
  actions: [],
  resolutions: new Map(),
  resultingOrder: {},
  ...overrides,
});

const deps = (
  io: FakeIo,
  overrides: Partial<Omit<Deps, "io">> & { plan?: PlanResult; respond?: () => unknown } = {},
): Deps => ({
  io,
  output: fakeOutput,
  buildPlan: overrides.buildPlan ?? (() => Promise.resolve(overrides.plan ?? fakePlan())),
  createClient:
    overrides.createClient ??
    ((): BacklogClient => ({
      get: () => Promise.resolve({}),
      send: () => Promise.resolve((overrides.respond ?? (() => ({ id: 1 })))()),
    })),
});

describe("コマンド体系", () => {
  it("バージョンを尋ねると標準出力に書いて 0 で終わる", async () => {
    const io = fakeIo();

    await expect(runCli(["--version"], deps(io))).resolves.toBe(0);
    expect(io.stdout).not.toBe("");
  });

  it("知らないコマンドは 1 で終わる", async () => {
    const io = fakeIo();

    await expect(runCli(["destroy", "-f", "-"], deps(io))).resolves.toBe(1);
  });

  it("マニフェストを指定しないと 1 で終わる", async () => {
    const io = fakeIo();

    await expect(runCli(["validate"], deps(io))).resolves.toBe(1);
  });
});

describe("CL-3 マニフェストは1つだけ", () => {
  it("-f を2回渡すと受け付けない", async () => {
    const io = fakeIo();

    await expect(runCli(["validate", "-f", "a.yaml", "-f", "b.yaml"], deps(io))).resolves.toBe(1);
  });
});

describe("CL-2 API キーの渡し方", () => {
  it("--api-key は受け付けない", async () => {
    const io = fakeIo();

    await expect(runCli(["plan", "-f", "-", "--api-key", API_KEY], deps(io))).resolves.toBe(1);
  });

  it("BACKLOG_API_KEY が無ければ plan は Backlog に触れずに止まる", async () => {
    const io = fakeIo({ env: { BACKLOG_SPACE: "example.backlog.com" } });
    let contacted = false;

    await expect(
      runCli(
        ["plan", "-f", "-"],
        deps(io, {
          buildPlan: () => {
            contacted = true;

            return Promise.resolve(fakePlan());
          },
        }),
      ),
    ).resolves.toBe(1);
    expect(contacted).toBe(false);
    expect(io.stderr).toContain("BACKLOG_API_KEY");
  });
});

describe("スペースの指定", () => {
  it("--space が無ければ BACKLOG_SPACE を使う", async () => {
    const io = fakeIo();
    let space = "";

    await expect(
      runCli(
        ["plan", "-f", "-"],
        deps(io, {
          createClient: ({ space: given }) => {
            space = given;

            return { get: () => Promise.resolve({}), send: () => Promise.resolve({}) };
          },
        }),
      ),
    ).resolves.toBe(0);
    expect(space).toBe("example.backlog.com");
  });

  it("--space は環境変数より優先される", async () => {
    const io = fakeIo();
    let space = "";

    await runCli(
      ["plan", "-f", "-", "--space", "other.backlog.jp"],
      deps(io, {
        createClient: ({ space: given }) => {
          space = given;

          return { get: () => Promise.resolve({}), send: () => Promise.resolve({}) };
        },
      }),
    );

    expect(space).toBe("other.backlog.jp");
  });

  it("スペースがどこにも無ければ止まる", async () => {
    const io = fakeIo({ env: { BACKLOG_API_KEY: API_KEY } });

    await expect(runCli(["plan", "-f", "-"], deps(io))).resolves.toBe(1);
    expect(io.stderr).toContain("--space");
  });
});

describe("マニフェストの受け取り", () => {
  it("パスを渡すとそのファイルを読む", async () => {
    const directory = await mkdtemp(join(tmpdir(), "backlog-blueprint-"));
    const path = join(directory, "PROJ_A.yaml");

    await writeFile(path, MANIFEST, "utf8");

    const io = fakeIo({ stdin: "key: BROKEN\n" });

    await expect(runCli(["validate", "-f", path], deps(io))).resolves.toBe(0);
  });

  it("- を渡すと標準入力を読む", async () => {
    const io = fakeIo({ stdin: "issueTypes: []\n" });

    await expect(runCli(["validate", "-f", "-"], deps(io))).resolves.toBe(1);
  });
});

describe("VP-1 validate における未解決の ${ENV}", () => {
  it("値が無くても警告に留まり、検証は通過する", async () => {
    const io = fakeIo({ stdin: `key: PROJ_A\nname: \${MISSING}\n${ISSUE_TYPES}`, env: {} });

    await expect(runCli(["validate", "-f", "-"], deps(io))).resolves.toBe(0);
    expect(io.stderr).toContain("warning");
  });

  it("plan では同じマニフェストがエラーで止まる", async () => {
    const io = fakeIo({
      stdin: `key: PROJ_A\nname: \${MISSING}\n${ISSUE_TYPES}`,
      env: { BACKLOG_API_KEY: API_KEY, BACKLOG_SPACE: "example.backlog.com" },
    });

    await expect(runCli(["plan", "-f", "-"], deps(io))).resolves.toBe(1);
    expect(io.stderr).toContain("error");
  });
});

describe("§1.5 終了コード", () => {
  it("validate は検証を通過すると 0 で終わる", async () => {
    const io = fakeIo();

    await expect(runCli(["validate", "-f", "-"], deps(io))).resolves.toBe(0);
  });

  it("validate は検証違反があると 1 で終わる", async () => {
    const io = fakeIo({ stdin: `key: proj a\nname: x\n${ISSUE_TYPES}` });

    await expect(runCli(["validate", "-f", "-"], deps(io))).resolves.toBe(1);
  });

  it("plan は差分が無ければ 0 で終わる", async () => {
    const io = fakeIo();

    await expect(runCli(["plan", "-f", "-"], deps(io))).resolves.toBe(0);
  });

  it("plan は差分があれば 2 で終わる", async () => {
    const io = fakeIo();

    await expect(
      runCli(["plan", "-f", "-"], deps(io, { plan: fakePlan({ actions: [anAction()] }) })),
    ).resolves.toBe(2);
  });

  it("一致している Action しかなければ plan は差分なしとして 0 で終わる", async () => {
    const io = fakeIo();
    const noop = anAction({ id: "milestones/noop/v1", op: "noop", writeRequest: false });

    await expect(
      runCli(["plan", "-f", "-"], deps(io, { plan: fakePlan({ actions: [noop] }) })),
    ).resolves.toBe(0);
  });

  it("plan は検証違反があると 1 で終わる", async () => {
    const io = fakeIo();
    const violation: Diagnostic = {
      id: "V-B2",
      severity: "error",
      stage: "auth",
      path: "",
      message: "not a space administrator",
    };

    await expect(
      runCli(["plan", "-f", "-"], deps(io, { plan: fakePlan({ diagnostics: [violation] }) })),
    ).resolves.toBe(1);
  });

  it("plan は取得に失敗すると 1 で終わる", async () => {
    const io = fakeIo();

    await expect(
      runCli(
        ["plan", "-f", "-"],
        deps(io, {
          buildPlan: () => Promise.reject({ status: 401, errors: [{ message: "Unauthorized." }] }),
        }),
      ),
    ).resolves.toBe(1);
    expect(io.stderr).toContain("401");
  });

  it("確認プロンプトを拒否すると 1 で終わる", async () => {
    const io = fakeIo({ answers: ["no"] });

    await expect(
      runCli(["apply", "-f", "-"], deps(io, { plan: fakePlan({ actions: [anAction()] }) })),
    ).resolves.toBe(1);
    expect(io.stdout).toContain("apply-result:rejected");
  });

  it("apply は成功すると 0 で終わる", async () => {
    const io = fakeIo();

    await expect(
      runCli(
        ["apply", "-f", "-", "--auto-approve"],
        deps(io, { plan: fakePlan({ actions: [anAction()] }) }),
      ),
    ).resolves.toBe(0);
    expect(io.stdout).toContain("apply-result:succeeded");
  });

  it("apply は中断すると 1 で終わる", async () => {
    const io = fakeIo();

    await expect(
      runCli(
        ["apply", "-f", "-", "--auto-approve"],
        deps(io, {
          plan: fakePlan({ actions: [anAction()] }),
          respond: () => {
            throw { status: 400, errors: [{ message: "bad request" }] };
          },
        }),
      ),
    ).resolves.toBe(1);
    expect(io.stdout).toContain("apply-result:aborted");
  });
});

describe("CL-4 / CL-5 / CL-6 確認プロンプト", () => {
  it("apply は既定で確認を求める", async () => {
    const io = fakeIo({ answers: ["yes"] });

    await runCli(["apply", "-f", "-"], deps(io, { plan: fakePlan({ actions: [anAction()] }) }));

    expect(io.stderr).toContain('Only "yes" will be accepted to confirm.');
  });

  it("yes の全文入力で実行される", async () => {
    const io = fakeIo({ answers: ["yes"] });

    await expect(
      runCli(["apply", "-f", "-"], deps(io, { plan: fakePlan({ actions: [anAction()] }) })),
    ).resolves.toBe(0);
  });

  it("y では通さない", async () => {
    const io = fakeIo({ answers: ["y"] });
    let sent = 0;

    await expect(
      runCli(
        ["apply", "-f", "-"],
        deps(io, {
          plan: fakePlan({ actions: [anAction()] }),
          createClient: () => ({
            get: () => Promise.resolve({}),
            send: () => {
              sent += 1;

              return Promise.resolve({ id: 1 });
            },
          }),
        }),
      ),
    ).resolves.toBe(1);
    expect(sent).toBe(0);
    expect(io.stdout).toContain("apply-result:rejected");
  });

  it("--auto-approve は確認を省略する", async () => {
    const io = fakeIo({ answers: [] });

    await expect(
      runCli(
        ["apply", "-f", "-", "--auto-approve"],
        deps(io, { plan: fakePlan({ actions: [anAction()] }) }),
      ),
    ).resolves.toBe(0);
    expect(io.stderr).not.toContain("Enter a value");
  });

  it("標準入力が端末でなければ --auto-approve が無い限り止まる", async () => {
    const io = fakeIo({ isStdinTty: false });

    await expect(
      runCli(["apply", "-f", "-"], deps(io, { plan: fakePlan({ actions: [anAction()] }) })),
    ).resolves.toBe(1);
    expect(io.stderr).toContain("apply requires confirmation, but stdin is not a terminal.");
    expect(io.stderr).toContain("pass --auto-approve to skip the confirmation");
  });

  it("標準入力が端末でなくても --auto-approve があれば進む", async () => {
    const io = fakeIo({ isStdinTty: false });

    await expect(
      runCli(
        ["apply", "-f", "-", "--auto-approve"],
        deps(io, { plan: fakePlan({ actions: [anAction()] }) }),
      ),
    ).resolves.toBe(0);
  });
});

describe("§1.3 標準出力と標準エラー出力", () => {
  it("--output json のとき標準出力は JSON だけになる", async () => {
    const io = fakeIo();
    const warning: Diagnostic = {
      id: "V-A15",
      severity: "warning",
      stage: "plan",
      path: "categories",
      message: "resulting order differs",
    };

    await runCli(
      ["plan", "-f", "-", "--output", "json"],
      deps(io, { plan: fakePlan({ actions: [anAction()], diagnostics: [warning] }) }),
    );

    expect(() => JSON.parse(io.stdout) as unknown).not.toThrow();
    expect(io.stderr).toContain("V-A15");
  });

  it("apply の --output json でも標準出力は JSON 1つだけになる", async () => {
    const io = fakeIo();

    await runCli(
      ["apply", "-f", "-", "--auto-approve", "--output", "json"],
      deps(io, { plan: fakePlan({ actions: [anAction()] }) }),
    );

    expect(JSON.parse(io.stdout)).toStrictEqual({ result: "succeeded" });
  });

  it("--output text では警告を標準エラー出力に写さない", async () => {
    const io = fakeIo();
    const warning: Diagnostic = {
      id: "V-A15",
      severity: "warning",
      stage: "plan",
      path: "categories",
      message: "resulting order differs",
    };

    await runCli(
      ["plan", "-f", "-"],
      deps(io, { plan: fakePlan({ actions: [anAction()], diagnostics: [warning] }) }),
    );

    expect(io.stderr).not.toContain("V-A15");
  });

  it("validate の --output json は標準出力に JSON だけを書く", async () => {
    const io = fakeIo();

    await runCli(["validate", "-f", "-", "--output", "json"], deps(io));

    expect(() => JSON.parse(io.stdout) as unknown).not.toThrow();
  });

  it("validate は --output text では標準出力に何も書かない", async () => {
    const io = fakeIo();

    await runCli(["validate", "-f", "-"], deps(io));

    expect(io.stdout).toBe("");
  });

  it("進捗は標準エラー出力に書く", async () => {
    const io = fakeIo();

    await runCli(
      ["apply", "-f", "-", "--auto-approve"],
      deps(io, { plan: fakePlan({ actions: [anAction()] }) }),
    );

    expect(io.stderr).toContain("progress:actionStarted");
    expect(io.stdout).not.toContain("progress:");
  });

  it("確認プロンプトは標準エラー出力に書く", async () => {
    const io = fakeIo({ answers: ["yes"] });

    await runCli(["apply", "-f", "-"], deps(io, { plan: fakePlan({ actions: [anAction()] }) }));

    expect(io.stdout).not.toContain("Enter a value");
  });

  it("計画の本文は標準出力に書く", async () => {
    const io = fakeIo();

    await runCli(["plan", "-f", "-"], deps(io, { plan: fakePlan({ actions: [anAction()] }) }));

    expect(io.stdout).toContain("plan-body");
  });
});

describe("表示の切り替え", () => {
  it("--show-unchanged は描画に渡る", async () => {
    const io = fakeIo();

    await runCli(["plan", "-f", "-", "--show-unchanged"], deps(io));

    expect(io.stdout).toContain("showUnchanged=true");
  });

  it("--no-color は色を落とす", async () => {
    const io = fakeIo();

    await runCli(["plan", "-f", "-", "--no-color"], deps(io));

    expect(io.stdout).toContain("color=false");
  });

  it("NO_COLOR が設定されていれば色を落とす", async () => {
    const io = fakeIo({
      env: { BACKLOG_API_KEY: API_KEY, BACKLOG_SPACE: "example.backlog.com", NO_COLOR: "1" },
    });

    await runCli(["plan", "-f", "-"], deps(io));

    expect(io.stdout).toContain("color=false");
  });

  it("NO_COLOR が空なら色を落とさない", async () => {
    const io = fakeIo({
      env: { BACKLOG_API_KEY: API_KEY, BACKLOG_SPACE: "example.backlog.com", NO_COLOR: "" },
    });

    await runCli(["plan", "-f", "-"], deps(io));

    expect(io.stdout).toContain("color=true");
  });
});

describe("NFR-3 / AC-10 API キーを出さない", () => {
  it("plan の出力のどこにも API キーが現れない", async () => {
    const io = fakeIo();

    await runCli(
      ["plan", "-f", "-", "--output", "json"],
      deps(io, { plan: fakePlan({ actions: [anAction()] }) }),
    );

    expect(io.stdout).not.toContain(API_KEY);
    expect(io.stderr).not.toContain(API_KEY);
  });

  it("apply が中断しても API キーが現れない", async () => {
    const io = fakeIo();

    await runCli(
      ["apply", "-f", "-", "--auto-approve"],
      deps(io, {
        plan: fakePlan({ actions: [anAction()] }),
        respond: () => {
          throw { status: 401, errors: [{ message: "Unauthorized." }] };
        },
      }),
    );

    expect(io.stdout).not.toContain(API_KEY);
    expect(io.stderr).not.toContain(API_KEY);
  });

  it("認証情報が足りないと言うときも API キーを書かない", async () => {
    const io = fakeIo({ env: { BACKLOG_API_KEY: API_KEY } });

    await runCli(["plan", "-f", "-"], deps(io));

    expect(io.stderr).not.toContain(API_KEY);
  });
});
