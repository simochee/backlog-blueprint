import { type Diagnostic } from "../diagnostic";
import { orderDiagnostics } from "../validation/gate";
import { type Paint, plain } from "./color";

/**
 * 表示では添字を落とし、ドットで継ぐ。`path` がスラッシュ区切りで配列に添字を持つ
 * のは消費側のための約束（DG-4）で、利用者が読むのはマニフェストのキーである
 * （§1.1 の `access.members` / §5.3 の `statuses`）。
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
 * `Nothing has been applied.` を添えるかは呼び出し側が決める（要件定義 §5.3）。
 * `validate` と `plan` はもともと何も適用しないので、そこで言うと意味をなさない。
 */
export type DiagnosticOptions = { paint?: Paint; nothingApplied?: boolean };

const errorSummary = (diagnostics: Diagnostic[], nothingApplied: boolean): string[] => {
  const count = diagnostics.filter(({ severity }) => severity === "error").length;

  if (count === 0) {
    return [];
  }

  const errors = count === 1 ? "1 validation error." : `${count} validation errors.`;

  return [nothingApplied ? `${errors} Nothing has been applied.` : errors];
};

/**
 * 並べ替えをここでもう一度行う。`orderDiagnostics` は冪等なので、呼び出し側が
 * 通し忘れても DG-3 の順が出力に出る。
 */
export const renderDiagnostics = (
  diagnostics: Diagnostic[],
  { paint = plain, nothingApplied = false }: DiagnosticOptions = {},
): string =>
  [
    ...errorSummary(diagnostics, nothingApplied),
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
