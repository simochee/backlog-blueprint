import {
  painter,
  progressOutcome,
  renderApplyJson,
  renderApplyResult,
  renderDiagnostics,
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

/**
 * 書き出す単位を必ず改行で終わらせる。core の描画は文字列を返すだけで（C-4）、
 * 末尾の改行を持つものと持たないものがある。持たない側をそのまま書くと、
 * 次に書かれたものと同じ行に続いてしまう。
 */
const block = (text: string): string => (text.endsWith("\n") ? text : `${text}\n`);

type Started = { index: number; total: number; action: Action };

/**
 * 進捗の行を成否が分かってから書く。`renderProgress` は位置と結果を1行にまとめる
 * （plan の出力仕様 §3.1）が、位置を持つのは `actionStarted` だけで、成否を持つのは
 * その次のイベントである。行の書き換えは TTY にしか無い表現なので core に置けない。
 */
export const createOutput = (): Output => {
  let started: Started | undefined;

  return {
    diagnostics: (diagnostics, { color, nothingApplied }) =>
      block(renderDiagnostics(diagnostics, { paint: painter(color), nothingApplied })),

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
  };
};
