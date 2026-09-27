import { type Paint, plain } from "./color";

export type ExportNotesInput = {
  projectKey: string;
  issueCount: number;
};

const issuesNote = (projectKey: string, issueCount: number, paint: Paint): string =>
  [
    paint(
      "note",
      `NOTE  ${projectKey} holds ${issueCount === 1 ? "1 issue" : `${issueCount} issues`}, so plan and apply will refuse it as a target (V-B3)`,
    ),
    "  → to use this manifest as a template, change key and name before you apply it",
  ].join("\n");

export const renderExportNotes = (
  { projectKey, issueCount }: ExportNotesInput,
  { paint = plain }: { paint?: Paint } = {},
): string => (issueCount > 0 ? issuesNote(projectKey, issueCount, paint) : "");
