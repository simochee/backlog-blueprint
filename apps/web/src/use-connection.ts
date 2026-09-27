import { type Diagnostic } from "@backlog-blueprint/core";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";

import { connect, type Connection } from "./connection";
import { revealApiKey, setApiKey } from "./secrets";
import { forgetCredentials, readStoredCredentials, storeCredentials } from "./session";
import { adoptTransport, candidateTransport, closeTransport } from "./transport";

type Session = { id: number; domain: string; connection: Connection };

type ConnectAttempt = { formId: number; diagnostics: Diagnostic[]; failure?: unknown };

type ConnectionState = { settled: boolean; session?: Session; attempt?: ConnectAttempt };

type ConnectionRequest =
  | { type: "connect"; space: string; formId: number; restoring?: boolean }
  | { type: "disconnect" };

export const RESTORED_FORM_ID = 0;

let sessionCount = 0;

const failed = (
  previous: ConnectionState,
  request: { formId: number; restoring?: boolean },
  attempt: Omit<ConnectAttempt, "formId">,
): ConnectionState => {
  if (request.restoring === true) {
    forgetCredentials();
  }

  return {
    settled: true,
    session: previous.session,
    attempt: { ...attempt, formId: request.formId },
  };
};

type ConnectionControl = {
  session?: Session;
  attempt?: ConnectAttempt;
  connecting: boolean;
  reconnectingTo?: string;
  storedSpace: string;
  connectTo: (space: string, formId: number) => void;
  disconnect: () => void;
};

export const useConnection = (): ConnectionControl => {
  const [stored] = useState(readStoredCredentials);
  const [state, dispatch, connecting] = useActionState<ConnectionState, ConnectionRequest>(
    async (previous, request) => {
      if (request.type === "disconnect") {
        forgetCredentials();
        closeTransport();

        return { settled: true };
      }

      const apiKey = revealApiKey();

      try {
        const candidate = candidateTransport(request.space, apiKey);
        const { connection, diagnostics } = await connect(candidate.get);

        if (connection === undefined) {
          return failed(previous, request, { diagnostics });
        }

        adoptTransport(candidate);
        storeCredentials({ space: request.space, apiKey });
        sessionCount += 1;

        return { settled: true, session: { id: sessionCount, domain: request.space, connection } };
      } catch (error) {
        return failed(previous, request, { diagnostics: [], failure: error });
      }
    },
    { settled: false },
  );

  // StrictMode は効果を2回走らせるので、印を付けて1回に絞る。2回目も走らせると
  // 読み込みのたびに S5 の GET が倍になり、どちらの結果が残るかも決まらない。
  const restoreStarted = useRef(false);

  useEffect(() => {
    if (stored === undefined || restoreStarted.current) {
      return;
    }

    restoreStarted.current = true;
    setApiKey(stored.apiKey);
    startTransition(() => {
      dispatch({ type: "connect", space: stored.space, formId: RESTORED_FORM_ID, restoring: true });
    });
  }, [stored, dispatch]);

  return {
    session: state.session,
    attempt: state.attempt,
    connecting,
    reconnectingTo: stored !== undefined && !state.settled ? stored.space : undefined,
    storedSpace: stored?.space ?? "",
    connectTo: (space, formId) => {
      startTransition(() => {
        dispatch({ type: "connect", space, formId });
      });
    },
    disconnect: () => {
      startTransition(() => {
        dispatch({ type: "disconnect" });
      });
    },
  };
};
