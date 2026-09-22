import { type Diagnostic } from "@backlog-blueprint/core";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";

import { connect, type Connection } from "./connection";
import { revealApiKey, setApiKey } from "./secrets";
import { forgetCredentials, readStoredCredentials, storeCredentials } from "./session";
import { adoptTransport, candidateTransport, closeTransport } from "./transport";

/** 確立した接続。`id` が接続の印（WU-36）の元になる */
export type Session = { id: number; domain: string; connection: Connection };

/** 失敗した試み。どのフォームから出したかを持ち、開き直したフォームに前の失敗を出さない */
export type ConnectAttempt = { formId: number; diagnostics: Diagnostic[]; failure?: unknown };

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
  /** WU-38。保存から繋ぎ直せなかったものは、次の読み込みでまた試さない */
  if (request.restoring === true) {
    forgetCredentials();
  }

  return {
    settled: true,
    session: previous.session,
    attempt: { ...attempt, formId: request.formId },
  };
};

export type ConnectionControl = {
  session?: Session;
  attempt?: ConnectAttempt;
  connecting: boolean;
  /** 保存した資格情報で繋ぎ直している最中なら、その先のドメイン */
  reconnectingTo?: string;
  /** 初めに開く接続画面のドメイン欄に入れる値 */
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

  /**
   * StrictMode は効果を2回走らせるので、印を付けて1回に絞る。2回目も走らせると
   * 読み込みのたびに S5 の GET が倍になり、どちらの結果が残るかも決まらない。
   */
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
