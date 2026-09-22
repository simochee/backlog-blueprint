import {
  type Action,
  type ActionId,
  type Change,
  type HttpRequest,
  type Note,
  type ProvidedRef,
} from "../action";
import { type Diagnostic } from "../diagnostic";
import { resolvePath } from "../ref";
import { type ResolutionTable } from "../resolution";
import { type Op, type Phase, type ResourceKind } from "../resource";
import { type IdOrRef } from "../value";
import { type ActionFailure, type ApplyOptions, type ApplyOutcome } from "./apply";
import {
  executedActions,
  type PlanReport,
  type ResultingOrder,
  summarize,
  type Summary,
  type ValidateReport,
} from "./report";
import { orderDiagnostics } from "../validation/gate";

/**
 * 整数で持ち、破壊的変更のときだけ上げる（PO-6）。キーの追加では上げない。
 */
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
  resultingOrder: ResultingOrder;
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

/** 未解決の `Ref` はそのまま載せる（PO-5）。`changes` は全項目を含む（PO-11）。 */
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
  /** `noop` も必ず含める。人間向けとは逆である（PO-2） */
  actions: report.actions.map(actionJson),
  resultingOrder: report.resultingOrder,
});

const failedJson = (
  { action, status, errors }: ActionFailure,
  resolutions: ResolutionTable | undefined,
): FailedJson => {
  const { request } = action;
  const path =
    request === undefined || resolutions === undefined
      ? undefined
      : resolvePath(request.path, resolutions);

  return {
    id: action.id,
    request:
      request === undefined
        ? undefined
        : { method: request.method, path: path?.resolved === true ? path.value : request.path },
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

/**
 * 逐次ではなく最終結果1つを返す（PO-10）。消費側は CI のスクリプトで、
 * 途中経過ではなく結果を1つの値として受け取りたい。
 */
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
