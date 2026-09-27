import { type BacklogClient } from "@backlog-blueprint/backlog-client";

import {
  APPLY_CONFIRMATION,
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

import { isCredentialsError, resolveCredentials, type Credentials } from "./credentials";
import { EXIT_CHANGES, EXIT_ERROR, EXIT_SUCCESS } from "./exit-code";
import { type Io } from "./io";
import { readManifest } from "./manifest-source";
import {
  type BuildPlan,
  type CreateExport,
  type DiagnosticsOptions,
  type Output,
  type OutputContext,
  type PlanResult,
  type RenderOptions,
  type ToolContext,
} from "./ports";
import { TOOL } from "./version";

/**
 * 1つの真偽値にまとめない。本文は stdout、診断は stderr に出る（CLI 仕様 §1.3）ので、
 * パイプした本文から色が消えないか、端末の stderr から色が消えるかのどちらかになる。
 */
export type ColorOptions = { stdout: boolean; stderr: boolean };

export type ConnectionOptions = { space?: string; color: ColorOptions };

export type CommonOptions = ConnectionOptions & { file: string; output: "text" | "json" };

export type PlanOptions = CommonOptions & { showUnchanged: boolean };

export type ApplyOptions = CommonOptions & { autoApprove: boolean };

export type ExportOptions = ConnectionOptions & { key: string };

export type Deps = {
  io: Io;
  output: Output;
  buildPlan: BuildPlan;
  createExport: CreateExport;
  createClient: (credentials: Credentials) => BacklogClient;
};

type StaticValidation = {
  path: string;
  diagnostics: Diagnostic[];
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

const NOT_A_TERMINAL =
  "ERROR  apply requires confirmation, but stdin is not a terminal.\n  → pass --auto-approve to skip the confirmation\n";

type Confirmation = { confirmed: boolean } | { error: string };

/**
 * 全文の `yes` だけを通す（CL-5）。1文字で通すと Enter の連打で削除まで通ってしまう。
 * 非 TTY でプロンプトを出さずに拒否するのは、CI で確認待ちのままハングさせないため（CL-6）。
 */
const confirmApply = async (io: Io): Promise<Confirmation> => {
  if (!io.isStdinTty) {
    return { error: NOT_A_TERMINAL };
  }

  io.err(APPLY_CONFIRMATION);

  const answer = await io.readLine();

  io.err("\n");

  return { confirmed: answer.trim() === "yes" };
};

const bodyRender = ({ color }: ConnectionOptions): RenderOptions => ({ color: color.stdout });

const noticeRender = ({ color }: ConnectionOptions): RenderOptions => ({ color: color.stderr });

const applyNotice = (options: CommonOptions): DiagnosticsOptions => ({
  ...noticeRender(options),
  nothingApplied: true,
});

const validateStatically = async (
  options: CommonOptions,
  deps: Deps,
  unresolvedEnvSeverity: Diagnostic["severity"],
): Promise<StaticValidation> => {
  const source = await readManifest(options.file, deps.io);
  const { diagnostics, manifest } = validateManifest({
    text: source.text,
    schemaStage,
    env: deps.io.env,
    unresolvedEnvSeverity,
  });

  return {
    path: source.path,
    diagnostics,
    ...(manifest === undefined ? {} : { manifest }),
  };
};

/** 未解決の `${ENV}` をエラーにしない（VP-1）。`validate` はこの環境で実行できるかを問わない */
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

const prepare = async (
  options: CommonOptions,
  deps: Deps,
  notice: DiagnosticsOptions,
): Promise<Prepared> => {
  const { io, output } = deps;
  const statically = await validateStatically(options, deps, "error");

  if (statically.manifest === undefined) {
    io.err(output.diagnostics(statically.diagnostics, notice));

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
    });
    const diagnostics = orderDiagnostics([...statically.diagnostics, ...built.diagnostics]);

    if (built.plan === undefined || hasError(diagnostics)) {
      io.err(output.diagnostics(diagnostics, notice));

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
    io.err(output.failure(error, notice));

    return { ok: false, code: EXIT_ERROR };
  }
};

/** text では写さない。計画の本文が `Warnings:` を持ち（plan の出力仕様 §1.1）、二重に出る */
const echoWarnings = (plan: PlanResult, options: CommonOptions, deps: Deps): void => {
  if (options.output === "json" && plan.diagnostics.length > 0) {
    deps.io.err(deps.output.diagnostics(plan.diagnostics, noticeRender(options)));
  }
};

export const runPlan = async (options: PlanOptions, deps: Deps): Promise<number> => {
  const prepared = await prepare(options, deps, noticeRender(options));

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
  const prepared = await prepare(options, deps, applyNotice(options));

  if (!prepared.ok) {
    return prepared.code;
  }

  const { io, output } = deps;
  const { plan, context, client, manifest } = prepared;
  const progressRender = noticeRender(options);

  echoWarnings(plan, options, deps);

  // json では計画の本文を書かない。stdout は最後の JSON 1つだけで（PO-7）、先に書くと `| jq` が壊れる。
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

const exportNotice = (options: ConnectionOptions): DiagnosticsOptions => ({
  ...noticeRender(options),
  nothingWritten: true,
});

export const runExport = async (options: ExportOptions, deps: Deps): Promise<number> => {
  const { io, output } = deps;
  const credentials = resolveCredentials(options.space, io);

  if (isCredentialsError(credentials)) {
    io.err(credentials.error);

    return EXIT_ERROR;
  }

  const client = deps.createClient(credentials);
  const { diagnostics, exported } = await deps.createExport({
    projectKey: options.key,
    get: client.get,
    version: TOOL.version,
  });

  if (exported === undefined || hasError(diagnostics)) {
    io.err(output.diagnostics(diagnostics, exportNotice(options)));

    return EXIT_ERROR;
  }

  io.out(exported.yaml);

  const notes = output.exportNotes(
    {
      projectKey: exported.projectKey,
      issueCount: exported.issueCount,
    },
    noticeRender(options),
  );

  if (notes !== "") {
    io.err(notes);
  }

  return EXIT_SUCCESS;
};
