import { renderHttpFailure, type Diagnostic } from "@backlog-blueprint/core";
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";

import { LOGO_LOCKUP } from "../logos";
import { setApiKey } from "../secrets";
import { apiKeyPageUrl } from "../space";
import { DiagnosticList } from "./diagnostics";

type ConnectFormProps = {
  initialSpace: string;
  hasApiKey: boolean;
  connecting: boolean;
  onConnect: (space: string) => void;
  diagnostics: Diagnostic[];
  failure?: unknown;
};

type FormLayout = { layout: "card" } | { layout: "modal"; current: string };

const ConnectForm = ({
  initialSpace,
  hasApiKey,
  connecting,
  onConnect,
  diagnostics,
  failure,
  ...layout
}: ConnectFormProps & FormLayout) => {
  const [space, setSpace] = useState(initialSpace);
  const apiKeyPage = apiKeyPageUrl(space);
  const filled = space.trim() !== "" && hasApiKey;
  const canConnect = filled && !connecting;
  const prefix = layout.layout === "card" ? "" : "switch-";

  // 開いた時点で API キーの下書きを空にする。欄は非制御で初期値を持てない（§2.4）ので、
  // 前に打った値が secrets.ts に残っていると、空に見える欄のまま Connect が押せる。
  useEffect(() => {
    setApiKey("");
  }, []);

  const submit = (
    <button
      className={layout.layout === "card" ? "button connect-submit" : "button"}
      data-busy={connecting}
      data-size={layout.layout === "card" ? undefined : "modal"}
      data-variant="primary"
      disabled={!canConnect}
      title={filled || connecting ? undefined : "Enter a space domain and an API key"}
      type="submit"
    >
      {connecting ? <span aria-hidden className="spinner" /> : null}
      {connecting ? "Connecting..." : "Connect"}
    </button>
  );

  return (
    <form
      className={layout.layout === "card" ? "connect-card" : undefined}
      onSubmit={(event) => {
        event.preventDefault();

        if (canConnect) {
          onConnect(space.trim());
        }
      }}
    >
      <div className={layout.layout === "card" ? "contents" : "modal-body"}>
        {layout.layout === "card" ? (
          <div className="card-heading">
            <h1 id="connect-heading">Connect a space</h1>
            <span aria-hidden>BB-001</span>
          </div>
        ) : null}
        <div className="field">
          <label className="field-label" htmlFor={`${prefix}space-domain`}>
            Space domain
          </label>
          <input
            aria-invalid={failure !== undefined}
            autoFocus
            className="input"
            disabled={connecting}
            id={`${prefix}space-domain`}
            onChange={(event) => setSpace(event.target.value)}
            placeholder="example.backlog.com"
            spellCheck={false}
            value={space}
          />
          {apiKeyPage === undefined ? null : (
            <a className="api-key-link" href={apiKeyPage} rel="noreferrer" target="_blank">
              Get an API key on {space.trim()} ↗
            </a>
          )}
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${prefix}api-key`}>
            API key
          </label>
          <input
            aria-invalid={diagnostics.length > 0}
            autoComplete="off"
            className="input"
            disabled={connecting}
            id={`${prefix}api-key`}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Paste your API key"
            type="password"
          />
        </div>
        <DiagnosticList diagnostics={diagnostics} />
        {failure === undefined ? null : (
          <p className="failure mono">{renderHttpFailure(failure, { color: false })}</p>
        )}
        {layout.layout === "card" ? (
          <>
            {submit}
            <p className="note">
              The API key is kept in this tab only. Closing the tab or disconnecting erases it.
            </p>
          </>
        ) : (
          <p className="note">
            You stay connected to {layout.current} until the new connection succeeds. The API key is
            kept in this tab only.
          </p>
        )}
      </div>
      {layout.layout === "modal" ? (
        <div className="modal-footer">
          <Dialog.Close asChild>
            <button className="button" data-size="modal" type="button">
              Cancel
            </button>
          </Dialog.Close>
          {submit}
        </div>
      ) : null}
    </form>
  );
};

type ConnectScreenProps = ConnectFormProps & { reconnectingTo?: string };

const Dimension = () => (
  <div aria-hidden className="dimension">
    <span className="dimension-arm">
      <span className="dimension-tick" />
      <span className="dimension-arrow" data-direction="left" />
      <span className="dimension-line" />
    </span>
    <span>MANIFEST → PROJECT</span>
    <span className="dimension-arm">
      <span className="dimension-line" />
      <span className="dimension-arrow" data-direction="right" />
      <span className="dimension-tick" />
    </span>
  </div>
);

export const ConnectScreen = ({ reconnectingTo, ...form }: ConnectScreenProps) => (
  <main className="connect">
    {["top-left", "top-right", "bottom-left", "bottom-right"].map((corner) => (
      <span aria-hidden className="corner" data-corner={corner} key={corner} />
    ))}
    <span aria-hidden className="sheet-number">
      SHEET 01 · CONNECT
    </span>
    <div className="connect-stack">
      <div className="connect-logo">
        <img alt="Backlog Blueprint" src={LOGO_LOCKUP} />
        <Dimension />
      </div>
      {reconnectingTo === undefined ? (
        <section aria-labelledby="connect-heading">
          <ConnectForm {...form} layout="card" />
        </section>
      ) : (
        <div className="connect-card">
          <p className="reconnecting" role="status">
            <span aria-hidden className="spinner" />
            Reconnecting to {reconnectingTo}...
          </p>
        </div>
      )}
    </div>
  </main>
);

type ConnectDialogProps = ConnectFormProps & {
  open: boolean;
  current: string;
  onClose: () => void;
};

export const ConnectDialog = ({ open, current, onClose, ...form }: ConnectDialogProps) => (
  <Dialog.Root
    onOpenChange={(next) => {
      if (!next) {
        onClose();
      }
    }}
    open={open}
  >
    <Dialog.Portal>
      <Dialog.Overlay className="scrim" />
      <Dialog.Content aria-describedby={undefined} className="modal">
        <div className="modal-header">
          <Dialog.Title className="modal-title">Switch connection</Dialog.Title>
          <span className="modal-sheet">{current.split(".")[0]} → ?</span>
          <Dialog.Close asChild>
            <button aria-label="Close" className="close-button" type="button">
              ×
            </button>
          </Dialog.Close>
        </div>
        <ConnectForm {...form} current={current} layout="modal" />
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
);
