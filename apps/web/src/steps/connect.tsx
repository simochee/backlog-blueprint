import { renderHttpFailure, type Diagnostic } from "@backlog-blueprint/core";

import { DiagnosticList } from "../components/diagnostics";
import { type Connection } from "../connection";
import { setApiKey } from "../secrets";

export type ConnectStepProps = {
  space: string;
  onSpaceChange: (space: string) => void;
  canConnect: boolean;
  connecting: boolean;
  onConnect: () => void;
  connection?: Connection;
  diagnostics: Diagnostic[];
  failure?: unknown;
};

export const ConnectStep = ({
  space,
  onSpaceChange,
  canConnect,
  connecting,
  onConnect,
  connection,
  diagnostics,
  failure,
}: ConnectStepProps) => (
  <div className="step-body">
    <div className="field-row">
      <label className="field">
        <span className="field-label">Space domain</span>
        <input
          className="input"
          onChange={(event) => onSpaceChange(event.target.value)}
          placeholder="example.backlog.com"
          spellCheck={false}
          type="text"
          value={space}
        />
      </label>
      <label className="field">
        <span className="field-label">API key</span>
        <input
          autoComplete="off"
          className="input"
          onChange={(event) => setApiKey(event.target.value)}
          type="password"
        />
      </label>
    </div>
    <div className="actions">
      <button
        className="button primary"
        disabled={!canConnect || connecting}
        onClick={onConnect}
        type="button"
      >
        {connecting ? "Connecting" : "Connect"}
      </button>
    </div>
    {connection === undefined ? null : (
      <div className="connected">
        <p className="connected-user">Signed in as {connection.user} (Space Administrator)</p>
        <p className="connected-rate">
          Update rate limit: {connection.updateRateLimit.remaining} /{" "}
          {connection.updateRateLimit.limit} remaining
        </p>
      </div>
    )}
    <DiagnosticList diagnostics={diagnostics} />
    {failure === undefined ? null : (
      <pre className="failure">{renderHttpFailure(failure, { color: false })}</pre>
    )}
  </div>
);
