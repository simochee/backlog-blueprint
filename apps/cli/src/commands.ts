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

import { confirmApply, JSON_WITHOUT_AUTO_APPROVE } from "./confirm";
import {
  isCredentialsError,
  renderCredentialsError,
  resolveCredentials,
  type Credentials,
} from "./credentials";
import { EXIT_CHANGES, EXIT_ERROR, EXIT_SUCCESS } from "./exit-code";
import { type Io } from "./io";
import { manifestPath, readManifest, type ManifestSource } from "./manifest-source";
import {
  type BuildPlan,
  type CreateExport,
  type DiagnosticsOptions,
  type Output,
  type OutputContext,
  type PlanResult,
  type RenderOptions,
  type Stopped,
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

/** 全コマンドが持つ。`export` はこれだけを持つ（CL-7）。 */
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
  /** マニフェストを読めなかった。`--output json` でも文書を書けるよう、例外にせず返す（PO-13） */
  failure?: unknown;
};

type Prepared =
  | { ok: false; stopped: Stopped }
  | {
      ok: true;
      plan: PlanResult;
      context: OutputContext;
      client: BacklogClient;
      manifest: Manifest;
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
  let source: ManifestSource;

  try {
    source = await readManifest(options.file, deps.io);
  } catch (error) {
    return { path: manifestPath(options.file), diagnostics: [], failure: error };
  }

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

/**
 * 未解決の `${ENV}` を警告に下げる（VP-1）。`validate` が答えるのは
 * 「マニフェストの書き方が正しいか」であって「この環境で実行できるか」ではない。
 */
export const runValidate = async (options: CommonOptions, deps: Deps): Promise<number> => {
  const { io, output } = deps;
  const { path, diagnostics, failure } = await validateStatically(options, deps, "warning");
  const context: ToolContext = { tool: TOOL, manifest: { path } };

  if (failure !== undefined) {
    io.err(output.failure(failure, noticeRender(options)));
  }

  if (diagnostics.length > 0) {
    io.err(output.diagnostics(diagnostics, noticeRender(options)));
  }

  if (options.output === "json") {
    io.out(output.validateJson({ context, diagnostics, failure }));
  }

  return failure !== undefined || hasError(diagnostics) ? EXIT_ERROR : EXIT_SUCCESS;
};

/**
 * `--output json` のときだけ診断を stderr へ写す。text のときは計画の本文が
 * `Warnings:` を持つ（plan の出力仕様 §1.1）ので、写すと二重に出る。
 */
const echoDiagnostics = (diagnostics: Diagnostic[], options: CommonOptions, deps: Deps): void => {
  if (options.output === "json" && diagnostics.length > 0) {
    deps.io.err(deps.output.diagnostics(diagnostics, noticeRender(options)));
  }
};

const prepare = async (
  options: CommonOptions,
  deps: Deps,
  notice: DiagnosticsOptions,
): Promise<Prepared> => {
  const { io, output } = deps;
  const statically = await validateStatically(options, deps, "error");
  const offline: Stopped["context"] = { tool: TOOL, manifest: { path: statically.path } };

  /**
   * それまでの警告も文書に残す（PO-13）。`failure` で止まると計画の本文の
   * `Warnings:` が書かれないので、json のときは §1.3 のとおり stderr にも写す。
   */
  const stopWithFailure = (context: Stopped["context"], failure: unknown): Prepared => {
    echoDiagnostics(statically.diagnostics, options, deps);

    return { ok: false, stopped: { context, diagnostics: statically.diagnostics, failure } };
  };

  if (statically.failure !== undefined) {
    io.err(output.failure(statically.failure, notice));

    return stopWithFailure(offline, statically.failure);
  }

  if (statically.manifest === undefined) {
    io.err(output.diagnostics(statically.diagnostics, notice));

    return { ok: false, stopped: { context: offline, diagnostics: statically.diagnostics } };
  }

  const credentials = resolveCredentials(options.space, io);

  if (isCredentialsError(credentials)) {
    io.err(renderCredentialsError(credentials.error));

    return stopWithFailure(offline, { errors: [{ message: credentials.error.message }] });
  }

  const client = deps.createClient(credentials);
  const context: OutputContext = { ...offline, space: credentials.space };

  try {
    const built = await deps.buildPlan({
      manifest: statically.manifest,
      get: client.get,
    });
    const diagnostics = orderDiagnostics([...statically.diagnostics, ...built.diagnostics]);

    if (built.plan === undefined || hasError(diagnostics)) {
      io.err(output.diagnostics(diagnostics, notice));

      return { ok: false, stopped: { context, diagnostics } };
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

    return stopWithFailure(context, error);
  }
};

export const runPlan = async (options: PlanOptions, deps: Deps): Promise<number> => {
  const { io, output } = deps;
  const prepared = await prepare(options, deps, noticeRender(options));

  if (!prepared.ok) {
    if (options.output === "json") {
      io.out(output.stoppedPlanJson(prepared.stopped));
    }

    return EXIT_ERROR;
  }

  const { plan, context } = prepared;

  echoDiagnostics(plan.diagnostics, options, deps);

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
  const { io, output } = deps;

  if (options.output === "json" && !options.autoApprove) {
    io.err(JSON_WITHOUT_AUTO_APPROVE);

    return EXIT_ERROR;
  }

  const prepared = await prepare(options, deps, applyNotice(options));

  if (!prepared.ok) {
    if (options.output === "json") {
      io.out(output.stoppedApplyJson(prepared.stopped));
    }

    return EXIT_ERROR;
  }

  const { plan, context, client, manifest } = prepared;
  const progressRender = noticeRender(options);

  echoDiagnostics(plan.diagnostics, options, deps);

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

const exportNotice = (options: ConnectionOptions): DiagnosticsOptions => ({
  ...noticeRender(options),
  nothingWritten: true,
});

export const runExport = async (options: ExportOptions, deps: Deps): Promise<number> => {
  const { io, output } = deps;
  const credentials = resolveCredentials(options.space, io);

  if (isCredentialsError(credentials)) {
    io.err(renderCredentialsError(credentials.error));

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
