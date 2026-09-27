import { type Diagnostic } from "../diagnostic";
import { orderDiagnostics } from "../validation/gate";
import { type Paint, plain } from "./color";

/**
 * `path` をそのまま見せない。スラッシュ区切りと添字は消費側のための約束（DG-4）で、
 * 利用者が読むのはマニフェストのキー（§1.1 の `access.members`）。
 */
export const displayPath = (path: string): string =>
  path
    .split("/")
    .filter((segment) => segment !== "" && !/^\d+$/.test(segment))
    .join(".");

const severityLabel = (severity: Diagnostic["severity"]): string => severity.toUpperCase();

const messageLines = ({ message, hint }: Diagnostic, arrow: boolean): string[] => {
  const [, ...rest] = message.split("\n");
  const hintLines = hint === undefined ? [] : [arrow ? `→ ${hint}` : hint];

  return [...rest, ...hintLines];
};

const headline = ({ message }: Diagnostic): string => message.split("\n")[0] ?? "";

const indent = (width: number, lines: string[]): string[] =>
  lines.map((line) => `${" ".repeat(width)}${line}`);

/**
 * `Nothing has been applied.` を常には添えない（要件定義 §5.3）。`validate` と `plan` は
 * もともと何も適用せず、`export` は「書き出していない」と言う（CL-9）。
 */
export type DiagnosticOptions = {
  paint?: Paint;
  nothingApplied?: boolean;
  nothingWritten?: boolean;
};

type ErrorSummaryOptions = Required<Pick<DiagnosticOptions, "nothingApplied" | "nothingWritten">>;

const errorSummary = (
  diagnostics: Diagnostic[],
  { nothingApplied, nothingWritten }: ErrorSummaryOptions,
): string[] => {
  const count = diagnostics.filter(({ severity }) => severity === "error").length;

  if (count === 0) {
    return [];
  }

  const noun = nothingWritten ? "export" : "validation";
  const errors = count === 1 ? `1 ${noun} error.` : `${count} ${noun} errors.`;

  if (nothingApplied) {
    return [`${errors} Nothing has been applied.`];
  }

  return [nothingWritten ? `${errors} Nothing has been written.` : errors];
};

/** 並べ済みでも並べ直す。呼び出し側が通し忘れても DG-3 の順で出る */
export const renderDiagnostics = (
  diagnostics: Diagnostic[],
  { paint = plain, nothingApplied = false, nothingWritten = false }: DiagnosticOptions = {},
): string =>
  [
    ...errorSummary(diagnostics, { nothingApplied, nothingWritten }),
    ...orderDiagnostics(diagnostics).map((diagnostic) =>
      [
        paint(
          diagnostic.severity,
          `${severityLabel(diagnostic.severity)} [${diagnostic.id}] ${displayPath(diagnostic.path)}: ${headline(diagnostic)}`,
        ),
        ...indent(2, messageLines(diagnostic, true)),
      ].join("\n"),
    ),
  ].join("\n\n");

export const renderWarnings = (
  diagnostics: Diagnostic[],
  { paint = plain }: DiagnosticOptions = {},
): string => {
  const warnings = orderDiagnostics(diagnostics).filter(({ severity }) => severity === "warning");

  if (warnings.length === 0) {
    return "";
  }

  return [
    "Warnings:",
    ...warnings.flatMap((diagnostic) => [
      paint(
        "warning",
        `  ! [${diagnostic.id}] ${displayPath(diagnostic.path)}: ${headline(diagnostic)}`,
      ),
      ...indent(6, messageLines(diagnostic, false)),
    ]),
  ].join("\n");
};
