import { type Action } from "../action";
import { resolvePath } from "../ref";
import { type ResolutionTable } from "../resolution";
import { actionLine, changeLines } from "./action-line";
import { type ActionFailure, type ApplyOptions, type ApplyOutcome } from "./apply";
import { painter } from "./color";
import { renderWarnings } from "./diagnostics";
import { type PlanReport, summarize } from "./report";
import { failureDetail, failureStatus } from "../validation/http-failure";

const SECONDS_PER_MINUTE = 60;

const BODY_INDENT = "  ";

const CHANGE_INDENT = "      ";

export type TextOptions = { showUnchanged?: boolean; color?: boolean };

const formatDuration = (seconds: number): string =>
  seconds < SECONDS_PER_MINUTE
    ? `${seconds}s`
    : `${Math.floor(seconds / SECONDS_PER_MINUTE)}m ${seconds % SECONDS_PER_MINUTE}s`;

const paragraphs = (blocks: string[]): string =>
  `${blocks.filter((block) => block !== "").join("\n\n")}\n`;

const header = ({ project, space }: PlanReport): string =>
  [
    `Blueprint: ${project.key} (${space})`,
    ...(project.exists ? [] : ["Project does not exist and will be created."]),
  ].join("\n");

export const renderPlanText = (report: PlanReport, options: TextOptions = {}): string => {
  const paint = painter(options.color === true);
  const summary = summarize(report.actions);
  const warnings = renderWarnings(report.diagnostics, { paint });

  if (!summary.hasChanges) {
    return paragraphs([
      `${header(report)}\nNo changes. The project already matches the manifest.`,
      warnings,
    ]);
  }

  const shown =
    options.showUnchanged === true
      ? report.actions
      : report.actions.filter(({ op }) => op !== "noop");
  const body = shown
    .flatMap((action) => [
      `${BODY_INDENT}${actionLine(action, "plan", paint)}`,
      ...changeLines(action).map((line) => `${CHANGE_INDENT}${line}`),
    ])
    .join("\n");
  const footer = [
    `Plan: ${summary.create} to add, ${summary.update + summary.reorder} to change, ${summary.delete} to destroy, ${summary.noop} unchanged.`,
    `Write requests: ${summary.writeRequests} (estimated ${formatDuration(summary.estimatedSeconds)})`,
  ].join("\n");

  return paragraphs([header(report), body, warnings, footer]);
};

export const APPLY_CONFIRMATION = [
  "Do you want to apply these changes?",
  '  Only "yes" will be accepted to confirm.',
  "",
  "  Enter a value: ",
].join("\n");

/**
 * 待機は X-1 の1秒間隔では流れない。`waitingSeconds` を持つ行が出るのは 429 を
 * 受けたときだけである（§3.1 / core §7.1）。
 */
export type ProgressOutcome = "done" | "failed" | { waitingSeconds: number };

export type ProgressLine = {
  /** `ExecutionEvent.actionStarted` の添字は0始まりなので、ここで +1 する（core §7） */
  index: number;
  total: number;
  action: Action;
  outcome?: ProgressOutcome;
};

const outcomeSuffix = (outcome: ProgressOutcome | undefined): string => {
  if (outcome === undefined) {
    return "";
  }

  return typeof outcome === "string"
    ? ` ${outcome}`
    : ` rate limited, waiting ${outcome.waitingSeconds}s`;
};

export const renderProgress = (
  { index, total, action, outcome }: ProgressLine,
  options: TextOptions = {},
): string => {
  const paint = painter(options.color === true);
  const counter = `[${String(index + 1).padStart(String(total).length)}/${total}]`;

  return `${counter} ${actionLine(action, "progress", paint)} ...${outcomeSuffix(outcome)}`;
};

export const renderApplyComplete = (applied: Action[]): string => {
  const summary = summarize(applied);

  return `Apply complete. ${summary.create} added, ${summary.update + summary.reorder} changed, ${summary.delete} destroyed.`;
};

const failedRequest = (
  { action }: ActionFailure,
  resolutions: ResolutionTable | undefined,
): string => {
  const { request } = action;

  if (request === undefined) {
    return action.id;
  }

  const path = resolutions === undefined ? undefined : resolvePath(request.path, resolutions);

  return `${request.method} ${path?.resolved === true ? path.value : request.path}`;
};

const errorLines = ({ status, errors }: ActionFailure): string[] =>
  errors.map(({ message }) => `  ${status === undefined ? "" : `${status}  `}${message}`);

const actionList = (title: string, actions: Action[], paint: ReturnType<typeof painter>): string =>
  [
    `${title} (${actions.length}):`,
    ...actions.map((action) => `${BODY_INDENT}${actionLine(action, "summary", paint)}`),
  ].join("\n");

/**
 * 「もう一度実行すれば続きから進む」だけを書かない。再実行までに課題が1件でも
 * 作られると V-B3 で止まり、そのプロジェクトは二度と触れなくなる
 * （検証パイプライン §7.3）。条件を省くと案内が嘘になる。
 */
const RESUME_NOTICE = [
  "Re-run apply with the same manifest to continue. Already applied changes become no-ops.",
  "The project must still have zero issues at that point.",
].join("\n");

export const renderApplyAbort = (
  outcome: Extract<ApplyOutcome, { result: "aborted" }>,
  options: TextOptions & ApplyOptions = {},
): string => {
  const paint = painter(options.color === true);

  return paragraphs([
    [
      paint("error", `ERROR  ${failedRequest(outcome.failed, options.resolutions)}`),
      ...errorLines(outcome.failed),
    ].join("\n"),
    "Apply aborted. Nothing has been rolled back.",
    [
      actionList("Applied", outcome.applied, paint),
      actionList("Failed", [outcome.failed.action], paint),
      actionList("Not applied", outcome.pending, paint),
    ].join("\n"),
    RESUME_NOTICE,
  ]);
};

/** 拒否したときの1行（§3.2） */
export const APPLY_CANCELLED = "Apply cancelled. Nothing has been applied.";

export const renderApplyResult = (
  outcome: ApplyOutcome,
  options: TextOptions & ApplyOptions = {},
): string => {
  if (outcome.result === "rejected") {
    return `${APPLY_CANCELLED}\n`;
  }

  if (outcome.result === "succeeded") {
    return `${renderApplyComplete(outcome.applied)}\n`;
  }

  return renderApplyAbort(outcome, options);
};

/**
 * 失敗の中身だけを書き、リクエストの本文もヘッダも書かない。API キーはヘッダにしか
 * 存在しないので、ここに要求の中身を足した瞬間に CI のログへ流れる経路ができる
 * （NFR-3 / AC-10）。
 */
export const renderHttpFailure = (error: unknown, options: TextOptions = {}): string => {
  const paint = painter(options.color === true);
  const status = failureStatus(error);

  return `${paint("error", `ERROR  ${status === undefined ? "" : `${status}  `}${failureDetail(error)}`)}\n`;
};
