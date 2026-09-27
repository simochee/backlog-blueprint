import {
  type Action,
  type ActionId,
  type Change,
  executedActions,
  type HttpRequest,
  type Note,
  type ProvidedRef,
} from "../action";
import { type Diagnostic } from "../diagnostic";
import { type ResolutionTable } from "../resolution";
import { type Op, type Phase, type ResourceKind } from "../resource";
import { type ResourceOrder } from "../resulting-order";
import { type IdOrRef } from "../value";
import { type ActionFailure, type ApplyOptions, type ApplyOutcome, failedPath } from "./apply";
import { type PlanReport, summarize, type Summary, type ValidateReport } from "./report";
import { orderDiagnostics } from "../validation/gate";

/** キーの追加では上げない。上げるのは破壊的変更のときだけ（PO-6） */
const FORMAT_VERSION = 1;

export type ActionJson = {
  id: ActionId;
  phase: Phase;
  kind: ResourceKind;
  op: Op;
  name: string;
  writeRequest: boolean;
  target?: IdOrRef;
  provides?: ProvidedRef[];
  notes?: Note[];
  changes?: Change[];
  request?: HttpRequest;
};

export type ValidateJson = {
  formatVersion: number;
  tool: { name: string; version: string };
  manifest: { path: string };
  diagnostics: Diagnostic[];
};

export type PlanJson = {
  formatVersion: number;
  tool: { name: string; version: string };
  space: string;
  manifest: { path: string };
  project: { key: string; name: string; exists: boolean };
  summary: Summary;
  diagnostics: Diagnostic[];
  actions: ActionJson[];
  resultingOrder: ResourceOrder;
};

export type FailedJson = {
  id: ActionId;
  request?: { method: string; path: string };
  status?: number;
  errors: { message: string }[];
};

export type ApplyJson = PlanJson & {
  result: ApplyOutcome["result"];
  applied: ActionId[];
  failed?: FailedJson;
  pending: ActionId[];
};

/** 未解決の `Ref` を偽の ID で埋めず（PO-5）、`changes` も変わらない項目まで残す（PO-11） */
const actionJson = ({
  id,
  phase,
  kind,
  op,
  name,
  writeRequest,
  target,
  provides,
  notes,
  changes,
  request,
}: Action): ActionJson => ({
  id,
  phase,
  kind,
  op,
  name,
  writeRequest,
  target,
  provides,
  notes,
  changes,
  request,
});

export const validateJson = (report: ValidateReport): ValidateJson => ({
  formatVersion: FORMAT_VERSION,
  tool: report.tool,
  manifest: report.manifest,
  diagnostics: orderDiagnostics(report.diagnostics),
});

export const planJson = (report: PlanReport): PlanJson => ({
  formatVersion: FORMAT_VERSION,
  tool: report.tool,
  space: report.space,
  manifest: report.manifest,
  project: report.project,
  summary: summarize(report.actions),
  diagnostics: orderDiagnostics(report.diagnostics),
  // `noop` も捨てない。人間向けの出力とは逆（PO-2）
  actions: report.actions.map(actionJson),
  resultingOrder: report.resultingOrder,
});

const failedJson = (
  { action, status, errors }: ActionFailure,
  resolutions: ResolutionTable | undefined,
): FailedJson => {
  const { request } = action;

  return {
    id: action.id,
    request:
      request === undefined
        ? undefined
        : { method: request.method, path: failedPath(request, resolutions) },
    status,
    errors,
  };
};

const ids = (actions: Action[]): ActionId[] => actions.map(({ id }) => id);

const progress = (
  report: PlanReport,
  outcome: ApplyOutcome,
  resolutions: ResolutionTable | undefined,
): { applied: ActionId[]; failed?: FailedJson; pending: ActionId[] } => {
  if (outcome.result === "rejected") {
    return { applied: [], pending: ids(executedActions(report.actions)) };
  }

  if (outcome.result === "succeeded") {
    return { applied: ids(outcome.applied), pending: [] };
  }

  return {
    applied: ids(outcome.applied),
    failed: failedJson(outcome.failed, resolutions),
    pending: ids(outcome.pending),
  };
};

/** 途中経過を逐次流さない（PO-10）。消費側の CI スクリプトは結果を1つの値として受け取りたい */
export const applyJson = (
  report: PlanReport,
  outcome: ApplyOutcome,
  { resolutions }: ApplyOptions = {},
): ApplyJson => {
  const plan = planJson(report);
  const { applied, failed, pending } = progress(report, outcome, resolutions);

  return {
    formatVersion: plan.formatVersion,
    result: outcome.result,
    tool: plan.tool,
    space: plan.space,
    manifest: plan.manifest,
    project: plan.project,
    summary: plan.summary,
    diagnostics: plan.diagnostics,
    applied,
    failed,
    pending,
    actions: plan.actions,
    resultingOrder: plan.resultingOrder,
  };
};

const INDENT = 2;

export const renderValidateJson = (report: ValidateReport): string =>
  `${JSON.stringify(validateJson(report), null, INDENT)}\n`;

export const renderPlanJson = (report: PlanReport): string =>
  `${JSON.stringify(planJson(report), null, INDENT)}\n`;

export const renderApplyJson = (
  report: PlanReport,
  outcome: ApplyOutcome,
  options: ApplyOptions = {},
): string => `${JSON.stringify(applyJson(report, outcome, options), null, INDENT)}\n`;
