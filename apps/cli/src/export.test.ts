import { describe, expect, it } from "vitest";

import { type BacklogClient } from "@backlog-blueprint/backlog-client";
import {
  type CreateExportResult,
  type Diagnostic,
  type ManifestInput,
  type ProjectExport,
} from "@backlog-blueprint/core";

import { type Deps } from "./commands";
import { type Io } from "./io";
import { createOutput } from "./output";
import { runCli } from "./program";

const API_KEY = "api-key-must-never-be-printed";

const YAML = "key: PROJ_A\nname: Project A\n";

const MANIFEST: ManifestInput = { key: "PROJ_A", name: "Project A" };

type FakeIo = Io & { stdout: string; stderr: string };

const fakeIo = (
  env: Io["env"] = { BACKLOG_API_KEY: API_KEY, BACKLOG_SPACE: "example.backlog.com" },
): FakeIo => {
  const io: FakeIo = {
    stdout: "",
    stderr: "",
    out: (text) => {
      io.stdout += text;
    },
    err: (text) => {
      io.stderr += text;
    },
    readStdin: () => Promise.resolve(""),
    readLine: () => Promise.resolve(""),
    isStdinTty: true,
    isStdoutTty: true,
    isStderrTty: true,
    env,
  };

  return io;
};

const aProjectExport = (overrides: Partial<ProjectExport> = {}): ProjectExport => ({
  projectKey: "PROJ_A",
  yaml: YAML,
  manifest: MANIFEST,
  issueCount: 0,
  ...overrides,
});

const notCalled = (name: string) => (): Promise<never> =>
  Promise.reject(new Error(`${name} was not expected to be called`));

const deps = (io: FakeIo, overrides: Partial<Omit<Deps, "io" | "output">> = {}): Deps => ({
  io,
  output: createOutput(),
  buildPlan: notCalled("buildPlan"),
  createExport:
    overrides.createExport ??
    (() => Promise.resolve({ diagnostics: [], exported: aProjectExport() })),
  createClient:
    overrides.createClient ??
    ((): BacklogClient => ({
      get: notCalled("client.get"),
      send: notCalled("client.send"),
    })),
});

describe("export の書き出し", () => {
  it("成功すると Yaml が標準出力に1回だけ書かれ、案内が標準エラー出力に出る", async () => {
    const io = fakeIo();

    await expect(
      runCli(
        ["export", "PROJ_A"],
        deps(io, {
          createExport: () =>
            Promise.resolve({ diagnostics: [], exported: aProjectExport({ issueCount: 3 }) }),
        }),
      ),
    ).resolves.toBe(0);

    expect(io.stdout).toBe(YAML);
    expect(io.stderr).toContain("PROJ_A holds 3 issues");
  });

  it("案内することが何も無ければ標準エラー出力は空のまま", async () => {
    const io = fakeIo();

    await expect(
      runCli(
        ["export", "PROJ_A"],
        deps(io, {
          createExport: () => Promise.resolve({ diagnostics: [], exported: aProjectExport() }),
        }),
      ),
    ).resolves.toBe(0);

    expect(io.stdout).toBe(YAML);
    expect(io.stderr).toBe("");
  });

  it("診断で止まったときは標準出力が空になり、集計行が export のものになる", async () => {
    const io = fakeIo();
    const diagnostics: Diagnostic[] = [
      {
        id: "V-B1",
        severity: "error",
        stage: "auth",
        path: "",
        message: "GET /api/v2/users/myself failed",
      },
      { id: "V-B3", severity: "error", stage: "snapshot", path: "key", message: "another failure" },
    ];
    const result: CreateExportResult = { diagnostics };

    await expect(
      runCli(["export", "PROJ_A"], deps(io, { createExport: () => Promise.resolve(result) })),
    ).resolves.toBe(1);

    expect(io.stdout).toBe("");
    expect(io.stderr).toContain("2 export errors. Nothing has been written.");
  });

  it("読み取りの失敗は ERROR として標準エラー出力に出て 1 で終わる", async () => {
    const io = fakeIo();

    await expect(
      runCli(
        ["export", "PROJ_A"],
        deps(io, {
          createExport: () =>
            Promise.reject({ errors: [{ message: "GET /api/v2/projects/PROJ_A: Not Found" }] }),
        }),
      ),
    ).resolves.toBe(1);

    expect(io.stdout).toBe("");
    expect(io.stderr).toContain("ERROR  GET /api/v2/projects/PROJ_A: Not Found");
  });

  it("-f を受け付けず、標準出力に何も書かない", async () => {
    const io = fakeIo();

    await expect(runCli(["export", "PROJ_A", "-f", "x.yaml"], deps(io))).resolves.toBe(1);

    expect(io.stdout).toBe("");
  });

  it("--output を受け付けず、標準出力に何も書かない", async () => {
    const io = fakeIo();

    await expect(runCli(["export", "PROJ_A", "--output", "json"], deps(io))).resolves.toBe(1);

    expect(io.stdout).toBe("");
  });

  it("プロジェクトキーを2つ渡すと受け付けず、標準出力に何も書かない", async () => {
    const io = fakeIo();

    await expect(runCli(["export", "PROJ_A", "PROJ_B"], deps(io))).resolves.toBe(1);

    expect(io.stdout).toBe("");
  });
});
