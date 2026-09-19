import { type Diagnostic } from "../diagnostic";
import { type Manifest } from "../manifest";
import { type ProjectSnapshot } from "../resources/project";

/**
 * 位置を持たせない（DG-5）。S6 の判定はマニフェストだけでは成り立たず、
 * 行を指しても「そこを直せ」にならない場合がある。
 */
const snapshotDiagnostic = (
  id: string,
  path: string,
  message: string,
  hint: string,
): Diagnostic => ({ id, severity: "error", stage: "snapshot", path, message, hint });

/**
 * 省略された `subtaskingEnabled` を `false` と見なさない（K-3）。送らなければ現状が
 * 保たれるので、真かどうかは現状を見なければ決まらない。現状を持たない S4 に
 * 置けないのはこのためである。
 */
const currentSubtasking = (project: ProjectSnapshot): boolean | undefined =>
  project.exists ? project.settings.subtaskingEnabled === true : undefined;

export type SnapshotStageInput = { manifest: Manifest; project: ProjectSnapshot };

export const validateAgainstSnapshot = ({
  manifest,
  project,
}: SnapshotStageInput): Diagnostic[] => {
  const { grandchildIssueEnabled, subtaskingEnabled } = manifest.settings;

  if (grandchildIssueEnabled !== true) {
    return [];
  }

  const effective = subtaskingEnabled ?? currentSubtasking(project);

  if (effective === true) {
    return [];
  }

  /**
   * 未作成のプロジェクトで省略された場合もエラーにする。送らないキーの値を決めるのは
   * Backlog であり、ツールがその既定を持たない（K-3）以上、真であることを確認できない。
   * 現状が無いことと、現状が偽であることは別なのでメッセージも分ける。
   */
  const message = (): string => {
    if (subtaskingEnabled !== undefined) {
      return "grandchildIssueEnabled requires subtaskingEnabled to be true";
    }

    return project.exists
      ? `grandchildIssueEnabled requires subtaskingEnabled, which is not declared and is not enabled on ${manifest.key}`
      : `grandchildIssueEnabled requires subtaskingEnabled, which is not declared, and ${manifest.key} does not exist yet, so its current value cannot be read`;
  };

  return [
    snapshotDiagnostic(
      "V-A12",
      "settings/grandchildIssueEnabled",
      message(),
      "set settings.subtaskingEnabled to true, or set settings.grandchildIssueEnabled to false",
    ),
  ];
};
