import { type BacklogClient } from "@backlog-blueprint/backlog-client";

import {
  execute,
  hasError,
  orderDiagnostics,
  schemaStage,
  summarize,
  validateManifest,
  type Action,
  type ApplyOutcome,
  type Diagnostic,
  type ExecuteContext,
  type Manifest,
} from "@backlog-blueprint/core";

import { confirmApply } from "./confirm";
import { isCredentialsError, resolveCredentials, type Credentials } from "./credentials";
import { EXIT_CHANGES, EXIT_ERROR, EXIT_SUCCESS } from "./exit-code";
import { type Io } from "./io";
import { readManifest } from "./manifest-source";
import {
  type BuildPlan,
  type Output,
  type OutputContext,
  type PlanResult,
  type RenderOptions,
  type ToolContext,
} from "./ports";
import { TOOL } from "./version";

/**
 * 本文は stdout、診断・進捗・警告は stderr に出る（CLI 仕様 §1.3）ので、色は
 * 書き出す先ごとに持つ（plan の出力仕様 §1.2）。1つの真偽値にまとめると、
 * パイプしたときに本文から色が消えないか、端末の stderr から色が消えるかの
 * どちらかになる。
 */
export type ColorOptions = { stdout: boolean; stderr: boolean };

export type CommonOptions = {
  file: string;
  space?: string;
  output: "text" | "json";
  color: ColorOptions;
};

export type PlanOptions = CommonOptions & { showUnchanged: boolean };

export type ApplyOptions = CommonOptions & { autoApprove: boolean };

export type Deps = {
  io: Io;
  output: Output;
  buildPlan: BuildPlan;
  createClient: (credentials: Credentials) => BacklogClient;
};

type StaticValidation = {
  path: string;
  diagnostics: Diagnostic[];
  /** S2 が返す展開経路。そのまま `isSecret` になる（E-6 / FR-3.6） */
  expandedPaths: Set<string>;
  manifest?: Manifest;
};

type Prepared =
  | { ok: false; code: number }
  | {
      ok: true;
      plan: PlanResult;
      context: OutputContext;
      client: BacklogClient;
      manifest: Manifest;
    };

const bodyRender = ({ color }: CommonOptions): RenderOptions => ({ color: color.stdout });

const noticeRender = ({ color }: CommonOptions): RenderOptions => ({ color: color.stderr });

const validateStatically = async (
  options: CommonOptions,
  deps: Deps,
  unresolvedEnvSeverity: Diagnostic["severity"],
): Promise<StaticValidation> => {
  const source = await readManifest(options.file, deps.io);
  const { diagnostics, expandedPaths, manifest } = validateManifest({
    text: source.text,
    schemaStage,
    env: deps.io.env,
    unresolvedEnvSeverity,
  });

  return {
    path: source.path,
    diagnostics,
    expandedPaths,
    ...(manifest === undefined ? {} : { manifest }),
  };
};

/**
 * 未解決の `${ENV}` を警告に下げる（VP-1）。`validate` が答えるのは
 * 「マニフェストの書き方が正しいか」であって「この環境で実行できるか」ではない。
 */
export const runValidate = async (options: CommonOptions, deps: Deps): Promise<number> => {
  const { io, output } = deps;
  const { path, diagnostics } = await validateStatically(options, deps, "warning");
  const context: ToolContext = { tool: TOOL, manifest: { path } };

  if (diagnostics.length > 0) {
    io.err(output.diagnostics(diagnostics, noticeRender(options)));
  }

  if (options.output === "json") {
    io.out(output.validateJson({ context, diagnostics }));
  }

  return hasError(diagnostics) ? EXIT_ERROR : EXIT_SUCCESS;
};

const prepare = async (options: CommonOptions, deps: Deps): Promise<Prepared> => {
  const { io, output } = deps;
  const render = noticeRender(options);
  const statically = await validateStatically(options, deps, "error");

  if (statically.manifest === undefined) {
    io.err(output.diagnostics(statically.diagnostics, render));

    return { ok: false, code: EXIT_ERROR };
  }

  const credentials = resolveCredentials(options.space, io);

  if (isCredentialsError(credentials)) {
    io.err(credentials.error);

    return { ok: false, code: EXIT_ERROR };
  }

  const client = deps.createClient(credentials);
  const context: OutputContext = {
    tool: TOOL,
    space: credentials.space,
    manifest: { path: statically.path },
  };

  try {
    const built = await deps.buildPlan({
      manifest: statically.manifest,
      get: client.get,
      isSecret: (path) => statically.expandedPaths.has(path),
    });
    const diagnostics = orderDiagnostics([...statically.diagnostics, ...built.diagnostics]);

    if (built.plan === undefined || hasError(diagnostics)) {
      io.err(output.diagnostics(diagnostics, render));

      return { ok: false, code: EXIT_ERROR };
    }

    return {
      ok: true,
      plan: { ...built.plan, diagnostics },
      context,
      client,
      manifest: statically.manifest,
    };
  } catch (error) {
    io.err(output.failure(error, render));

    return { ok: false, code: EXIT_ERROR };
  }
};

/**
 * `--output json` のときだけ診断を stderr へ写す。text のときは計画の本文が
 * `Warnings:` を持つ（plan の出力仕様 §1.1）ので、写すと二重に出る。
 */
const echoWarnings = (plan: PlanResult, options: CommonOptions, deps: Deps): void => {
  if (options.output === "json" && plan.diagnostics.length > 0) {
    deps.io.err(deps.output.diagnostics(plan.diagnostics, noticeRender(options)));
  }
};

export const runPlan = async (options: PlanOptions, deps: Deps): Promise<number> => {
  const prepared = await prepare(options, deps);

  if (!prepared.ok) {
    return prepared.code;
  }

  const { io, output } = deps;
  const { plan, context } = prepared;

  echoWarnings(plan, options, deps);

  io.out(
    options.output === "json"
      ? output.planJson({ context, plan })
      : output.plan(
          { context, plan },
          { ...bodyRender(options), showUnchanged: options.showUnchanged },
        ),
  );

  return summarize(plan.actions).hasChanges ? EXIT_CHANGES : EXIT_SUCCESS;
};

const runExecution = async (
  plan: PlanResult,
  manifest: Manifest,
  client: BacklogClient,
  deps: Deps,
  render: RenderOptions,
): Promise<ApplyOutcome> => {
  const context: ExecuteContext = {
    projectKey: manifest.key,
    resolutions: plan.resolutions,
    get: client.get,
    send: client.send,
  };

  const applied: Action[] = [];

  let failure: { status?: number; errors: { message: string }[] } = { errors: [] };
  let outcome: ApplyOutcome = { result: "succeeded", applied };

  for await (const event of execute(plan.actions, context)) {
    const line = deps.output.progress(event, render);

    if (line !== undefined) {
      deps.io.err(line);
    }

    if (event.type === "actionSucceeded") {
      applied.push(event.action);
    }

    if (event.type === "actionFailed") {
      failure =
        event.status === undefined
          ? { errors: event.errors }
          : { status: event.status, errors: event.errors };
    }

    if (event.type === "aborted") {
      outcome = {
        result: "aborted",
        applied: event.applied,
        failed: { action: event.failed, ...failure },
        pending: event.pending,
      };
    }
  }

  return outcome;
};

export const runApply = async (options: ApplyOptions, deps: Deps): Promise<number> => {
  const prepared = await prepare(options, deps);

  if (!prepared.ok) {
    return prepared.code;
  }

  const { io, output } = deps;
  const { plan, context, client, manifest } = prepared;
  const progressRender = noticeRender(options);

  echoWarnings(plan, options, deps);

  /**
   * `--output json` では計画の本文を書かない。stdout に出てよいのは最後の
   * JSON 1つだけで（PO-7）、本文を先に書くと `| jq` が素通しで動かなくなる。
   */
  if (options.output === "text") {
    io.out(output.plan({ context, plan }, { ...bodyRender(options), showUnchanged: false }));
  }

  const approval = options.autoApprove ? { confirmed: true } : await confirmApply(io);

  if ("error" in approval) {
    io.err(approval.error);

    return EXIT_ERROR;
  }

  const outcome = approval.confirmed
    ? await runExecution(plan, manifest, client, deps, progressRender)
    : ({ result: "rejected" } as const);

  io.out(
    options.output === "json"
      ? output.applyJson({ context, plan, outcome })
      : output.applyResult({ context, plan, outcome }, bodyRender(options)),
  );

  return outcome.result === "succeeded" ? EXIT_SUCCESS : EXIT_ERROR;
};
