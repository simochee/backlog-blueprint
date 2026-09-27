import { type Diagnostic } from "@backlog-blueprint/core";

import { diagnosticView } from "../view";

type DiagnosticListProps = { diagnostics: Diagnostic[]; nothingWritten?: boolean };

const toneOf = ({ severity }: Diagnostic): "destroy" | "change" =>
  severity === "error" ? "destroy" : "change";

const position = ({ line, column }: Diagnostic): string =>
  line === undefined ? "" : `${line}:${column ?? 1}`;

const blockKey = (diagnostic: Diagnostic, index: number): string =>
  `${diagnostic.id}:${diagnostic.path}:${index}`;

export const DiagnosticList = ({ diagnostics, nothingWritten = false }: DiagnosticListProps) => {
  const { summary, blocks } = diagnosticView(diagnostics, { nothingWritten });

  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className="diagnostic-list">
      {summary === undefined ? null : <p className="diagnostic-summary">{summary}</p>}
      {blocks.map(({ diagnostic, message }, index) => (
        <div
          className="diagnostic-box"
          data-tone={toneOf(diagnostic)}
          key={blockKey(diagnostic, index)}
        >
          <span className="diagnostic-box-id">{diagnostic.id}</span>
          <span className="diagnostic-box-text mono">{message}</span>
        </div>
      ))}
    </div>
  );
};

type ProblemListProps = {
  diagnostics: Diagnostic[];
  documentName: string;
  onSelect: (diagnostic: Diagnostic) => void;
};

export const ProblemList = ({ diagnostics, documentName, onSelect }: ProblemListProps) => {
  const { blocks } = diagnosticView(diagnostics);

  if (blocks.length === 0) {
    return <p className="panel-empty">No problems in {documentName}.</p>;
  }

  return (
    <ul aria-label="Problems" className="problems">
      {blocks.map(({ diagnostic, message }, index) => (
        <li key={blockKey(diagnostic, index)}>
          <button
            className="problem"
            data-tone={toneOf(diagnostic)}
            onClick={() => onSelect(diagnostic)}
            type="button"
          >
            <span
              aria-label={diagnostic.severity}
              className="severity-mark"
              data-tone={toneOf(diagnostic)}
              role="img"
            />
            <span className="problem-location">{position(diagnostic)}</span>
            <span className="problem-id">{diagnostic.id}</span>
            <span className="mono">{message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
};

/** `renderWarnings` を使わない。端末向けに `Warnings:` の見出しと字下げを自分で持つ */
export const WarningList = ({ diagnostics }: { diagnostics: Diagnostic[] }) => {
  const { blocks } = diagnosticView(diagnostics.filter(({ severity }) => severity === "warning"));

  if (blocks.length === 0) {
    return null;
  }

  return (
    <section aria-label="Warnings" className="plan-warnings">
      <h3>Warnings · {blocks.length}</h3>
      {blocks.map(({ diagnostic, message }, index) => (
        <div className="warning-row" key={blockKey(diagnostic, index)}>
          <span className="warning-row-id">{diagnostic.id}</span>
          <span className="mono">{message}</span>
        </div>
      ))}
    </section>
  );
};
