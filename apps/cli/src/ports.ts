import {
  type Action,
  type ApplyOutcome,
  type Diagnostic,
  type ExecutionEvent,
  type Manifest,
  type PlanContext,
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

export type RenderOptions = { color: boolean };

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
  isSecret: PlanContext["isSecret"];
}) => Promise<PlanOutcome>;

/**
 * 描画は文字列を返すだけにする（C-4 / NFR-6）。ストリームもロガーも渡さない。
 * どこへ書くかは §1.3 が決める CLI の関心事で、描画側が書き出すと
 * `--output json` の stdout を汚さない保証（PO-7）が描画側にも分かれる。
 */
export type Output = {
  diagnostics: (diagnostics: Diagnostic[], options: RenderOptions) => string;
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
};
