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
  type ResultingOrder,
} from "@backlog-blueprint/core";

export type ToolContext = {
  tool: { name: string; version: string };
  manifest: { path: string };
};

/** `validate` はスペースを見ないので、`space` を持つのは plan / apply だけ（CL-1） */
export type OutputContext = ToolContext & { space: string };

/**
 * 計画を組み立てる前に止まった plan / apply（PO-13）。`space` は Backlog に
 * 問い合わせた後に止まったときだけ持ち、`failure` は診断として表せない失敗のときだけ持つ。
 */
export type Stopped = {
  context: ToolContext & { space?: string };
  diagnostics: Diagnostic[];
  failure?: unknown;
};

export type RenderOptions = { color: boolean };

/**
 * `Nothing has been applied.` を添えるのは `apply` だけ（要件定義 §5.3）。
 * `validate` と `plan` はもともと何も適用しない。
 */
export type DiagnosticsOptions = RenderOptions & {
  nothingApplied?: boolean;
  /** `export` のみ（CL-9）。集計行の名詞も export のものになる */
  nothingWritten?: boolean;
};

/**
 * S5〜S7 を走らせて計画を組み立てた結果。`resolutions` を持つのは、apply が
 * `ExecuteContext` を組むのに既存リソースの名前 → ID が要るため（core §3.2）。
 * `resultingOrder` は JSON 出力が持つ項目（plan の出力仕様 §2.1）。
 */
export type PlanResult = {
  project: { key: string; name: string; exists: boolean };
  diagnostics: Diagnostic[];
  actions: Action[];
  resolutions: ResolutionTable;
  resultingOrder: ResultingOrder;
};

/**
 * `plan` が空なのは、どこかのステージがエラーを出して先へ進まなかったこと（VG-2）。
 * `PlanResult` を必ず返す形にすると、エラーで止まった計画を空の `Action[]` として
 * 描けてしまい、「差分なし」と区別が付かなくなる。
 */
export type PlanOutcome = { diagnostics: Diagnostic[]; plan?: PlanResult };

export type BuildPlan = (input: {
  manifest: Manifest;
  get: ReadContext["get"];
}) => Promise<PlanOutcome>;

export type CreateExport = (input: CreateExportOptions) => Promise<CreateExportResult>;

/**
 * 描画は文字列を返すだけにする（C-4 / NFR-6）。ストリームもロガーも渡さない。
 * どこへ書くかは §1.3 が決める CLI の関心事で、描画側が書き出すと
 * `--output json` の stdout を汚さない保証（PO-7）が描画側にも分かれる。
 */
export type Output = {
  diagnostics: (diagnostics: Diagnostic[], options: DiagnosticsOptions) => string;
  failure: (error: unknown, options: RenderOptions) => string;
  validateJson: (input: {
    context: ToolContext;
    diagnostics: Diagnostic[];
    failure?: unknown;
  }) => string;
  plan: (
    input: { context: OutputContext; plan: PlanResult },
    options: RenderOptions & { showUnchanged: boolean },
  ) => string;
  planJson: (input: { context: OutputContext; plan: PlanResult }) => string;
  stoppedPlanJson: (input: Stopped) => string;
  progress: (event: ExecutionEvent, options: RenderOptions) => string | undefined;
  applyResult: (
    input: { context: OutputContext; plan: PlanResult; outcome: ApplyOutcome },
    options: RenderOptions,
  ) => string;
  applyJson: (input: { context: OutputContext; plan: PlanResult; outcome: ApplyOutcome }) => string;
  stoppedApplyJson: (input: Stopped) => string;
  exportNotes: (input: ExportNotesInput, options: RenderOptions) => string;
};
