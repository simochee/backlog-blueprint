import {
  type Action,
  type ApplyOutcome,
  type CreateExportOptions,
  type CreateExportResult,
  type Diagnostic,
  type ExecutionEvent,
  type ExportNotesInput,
  type Manifest,
  type ReadContext,
  type ResolutionTable,
  type ResourceOrder,
} from "@backlog-blueprint/core";

export type ToolContext = {
  tool: { name: string; version: string };
  manifest: { path: string };
};

/** `ToolContext` に `space` を入れない。`validate` はスペースを見ない（CL-1） */
export type OutputContext = ToolContext & { space: string };

export type RenderOptions = { color: boolean };

export type DiagnosticsOptions = RenderOptions & {
  nothingApplied?: boolean;
  nothingWritten?: boolean;
};

export type PlanResult = {
  project: { key: string; name: string; exists: boolean };
  diagnostics: Diagnostic[];
  actions: Action[];
  resolutions: ResolutionTable;
  resultingOrder: ResourceOrder;
};

/**
 * `plan` を必ず返す形にしない。エラーで止まった計画（VG-2）が空の `Action[]` として描けてしまい、
 * 「差分なし」と区別が付かなくなる。
 */
export type PlanOutcome = { diagnostics: Diagnostic[]; plan?: PlanResult };

export type BuildPlan = (input: {
  manifest: Manifest;
  get: ReadContext["get"];
}) => Promise<PlanOutcome>;

export type CreateExport = (input: CreateExportOptions) => Promise<CreateExportResult>;

/**
 * 描画にストリームもロガーも渡さない（C-4）。描画側が書き出すと、json の stdout を汚さない
 * 保証（PO-7）が描画側にも分かれる。
 */
export type Output = {
  diagnostics: (diagnostics: Diagnostic[], options: DiagnosticsOptions) => string;
  failure: (error: unknown, options: RenderOptions) => string;
  validateJson: (input: { context: ToolContext; diagnostics: Diagnostic[] }) => string;
  plan: (
    input: { context: OutputContext; plan: PlanResult },
    options: RenderOptions & { showUnchanged: boolean },
  ) => string;
  planJson: (input: { context: OutputContext; plan: PlanResult }) => string;
  progress: (event: ExecutionEvent, options: RenderOptions) => string | undefined;
  applyResult: (
    input: { context: OutputContext; plan: PlanResult; outcome: ApplyOutcome },
    options: RenderOptions,
  ) => string;
  applyJson: (input: { context: OutputContext; plan: PlanResult; outcome: ApplyOutcome }) => string;
  exportNotes: (input: ExportNotesInput, options: RenderOptions) => string;
};
