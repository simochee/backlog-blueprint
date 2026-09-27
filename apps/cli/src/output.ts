import {
  painter,
  progressOutcome,
  renderApplyJson,
  renderApplyResult,
  renderDiagnostics,
  renderExportNotes,
  renderHttpFailure,
  renderPlanJson,
  renderPlanText,
  renderProgress,
  renderValidateJson,
  type Action,
  type PlanReport,
} from "@backlog-blueprint/core";

import { type Output, type OutputContext, type PlanResult } from "./ports";

const report = (context: OutputContext, plan: PlanResult): PlanReport => ({
  tool: context.tool,
  space: context.space,
  manifest: context.manifest,
  project: plan.project,
  diagnostics: plan.diagnostics,
  actions: plan.actions,
  resultingOrder: plan.resultingOrder,
});

/** core の描画は末尾の改行を持つものと持たないものがあり、そのまま書くと次と同じ行に続く */
const block = (text: string): string => (text.endsWith("\n") ? text : `${text}\n`);

type Started = { index: number; total: number; action: Action };

/**
 * 進捗の行を成否が分かってから書く。1行に位置と結果を載せる（plan の出力仕様 §3.1）が、
 * 位置と成否は別のイベントで届く。行の書き換えで済ませる案は TTY にしか無く、core に置けない。
 */
export const createOutput = (): Output => {
  let started: Started | undefined;

  return {
    diagnostics: (diagnostics, { color, nothingApplied, nothingWritten }) =>
      block(
        renderDiagnostics(diagnostics, { paint: painter(color), nothingApplied, nothingWritten }),
      ),

    failure: (error, { color }) => block(renderHttpFailure(error, { color })),

    validateJson: ({ context, diagnostics }) =>
      renderValidateJson({ tool: context.tool, manifest: context.manifest, diagnostics }),

    plan: ({ context, plan }, { color, showUnchanged }) =>
      block(renderPlanText(report(context, plan), { color, showUnchanged })),

    planJson: ({ context, plan }) => renderPlanJson(report(context, plan)),

    progress: (event, { color }) => {
      if (event.type === "actionStarted") {
        started = { index: event.index, total: event.total, action: event.action };

        return undefined;
      }

      const outcome = progressOutcome(event);

      if (started === undefined || outcome === undefined) {
        return undefined;
      }

      return block(renderProgress({ ...started, outcome }, { color }));
    },

    applyResult: ({ plan, outcome }, { color }) =>
      block(renderApplyResult(outcome, { color, resolutions: plan.resolutions })),

    applyJson: ({ context, plan, outcome }) =>
      renderApplyJson(report(context, plan), outcome, { resolutions: plan.resolutions }),

    // 空を `block` に通さない。呼び出し側は空で「何も書かない」を判断する（CL-8）。
    exportNotes: (input, { color }) => {
      const notes = renderExportNotes(input, { paint: painter(color) });

      return notes === "" ? notes : block(notes);
    },
  };
};
