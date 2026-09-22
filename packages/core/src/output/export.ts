import { type Paint, plain } from "./color";

export type ExportNotesInput = {
  projectKey: string;
  issueCount: number;
};

type Note = { headline: string; body: string[]; hint: string };

const issuesNote = (projectKey: string, issueCount: number): Note => ({
  headline: `${projectKey} holds ${issueCount === 1 ? "1 issue" : `${issueCount} issues`}, so plan and apply will refuse it as a target (V-B3)`,
  body: [],
  hint: "to use this manifest as a template, change key and name before you apply it",
});

const render = ({ headline, body, hint }: Note, paint: Paint): string =>
  [paint("note", `NOTE  ${headline}`), ...body.map((line) => `  ${line}`), `  → ${hint}`].join(
    "\n",
  );

/**
 * 案内が1つも無ければ空文字列（CL-8）。件数が0のものは節ごと出さないので、
 * 呼び出し側は空でないときだけ stderr に書けばよい。
 */
export const renderExportNotes = (
  { projectKey, issueCount }: ExportNotesInput,
  { paint = plain }: { paint?: Paint } = {},
): string => (issueCount > 0 ? render(issuesNote(projectKey, issueCount), paint) : "");
