import { type Diagnostic } from "@backlog-blueprint/core";

import { diagnosticView } from "../view";

export type DiagnosticListProps = { diagnostics: Diagnostic[] };

const position = ({ line, column }: Diagnostic): string =>
  line === undefined ? "" : `${line}:${column ?? 1}`;

export const DiagnosticList = ({ diagnostics }: DiagnosticListProps) => {
  const { summary, blocks } = diagnosticView(diagnostics);

  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className="diagnostics">
      {summary === undefined ? null : <p className="diagnostics-summary">{summary}</p>}
      <ul className="diagnostic-list">
        {blocks.map(({ diagnostic, text }, index) => (
          <li
            className="diagnostic"
            data-severity={diagnostic.severity}
            key={`${diagnostic.id}:${diagnostic.path}:${index}`}
          >
            <span className="diagnostic-position">{position(diagnostic)}</span>
            <pre className="diagnostic-text">{text}</pre>
          </li>
        ))}
      </ul>
    </div>
  );
};
