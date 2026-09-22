import { type WebhookVariable } from "../export/to-manifest";
import { type Paint, plain } from "./color";

export type ExportNotesInput = {
  projectKey: string;
  issueCount: number;
  webhookVariables: WebhookVariable[];
};

type Note = { headline: string; body: string[]; hint: string };

const issuesNote = (projectKey: string, issueCount: number): Note => ({
  headline: `${projectKey} holds ${issueCount === 1 ? "1 issue" : `${issueCount} issues`}, so plan and apply will refuse it as a target (V-B3)`,
  body: [],
  hint: "to use this manifest as a template, change key and name before you apply it",
});

const webhooksNote = (variables: WebhookVariable[]): Note => ({
  headline:
    variables.length === 1
      ? "1 webhook URL was left out of the manifest and replaced with ${WEBHOOK_URL_1}:"
      : `${variables.length} webhook URLs were left out of the manifest and replaced with \${WEBHOOK_URL_n}:`,
  body: variables.map(({ variable, webhook }) => `${variable}  "${webhook}"`),
  hint: "set each variable to the URL shown on that webhook's page in Backlog before running plan. validate does not need them",
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
  { projectKey, issueCount, webhookVariables }: ExportNotesInput,
  { paint = plain }: { paint?: Paint } = {},
): string =>
  [
    ...(issueCount > 0 ? [issuesNote(projectKey, issueCount)] : []),
    ...(webhookVariables.length > 0 ? [webhooksNote(webhookVariables)] : []),
  ]
    .map((note) => render(note, paint))
    .join("\n\n");
