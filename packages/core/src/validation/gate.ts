import { type Diagnostic } from "../diagnostic";
import { UNRESOLVED_ENV_ID } from "./expand-stage";

const STAGE_ORDER: Diagnostic["stage"][] = [
  "syntax",
  "expand",
  "schema",
  "semantic",
  "auth",
  "snapshot",
  "plan",
];

const stageRank = (stage: Diagnostic["stage"]): number => STAGE_ORDER.indexOf(stage);

const lineRank = (diagnostic: Diagnostic): number => diagnostic.line ?? Number.POSITIVE_INFINITY;

export const orderDiagnostics = (diagnostics: Diagnostic[]): Diagnostic[] =>
  [...diagnostics].sort(
    (left, right) =>
      stageRank(left.stage) - stageRank(right.stage) || lineRank(left) - lineRank(right),
  );

export const hasError = (diagnostics: Diagnostic[]): boolean =>
  diagnostics.some(({ severity }) => severity === "error");

/**
 * 未解決の `${ENV}` だけはゲートを閉じない（VG-3）。番兵を入れて S3 / S4 まで
 * 進めるので、`hasError` をそのままゲートに使うと環境変数を1つ直すたびに
 * 次の違反が出るループに戻る。
 */
export const blocksNextStage = (diagnostics: Diagnostic[]): boolean =>
  diagnostics.some(
    ({ severity, stage, id }) =>
      severity === "error" && !(stage === "expand" && id === UNRESOLVED_ENV_ID),
  );
