import { type Action, type ProvidedRef, type ResolvedHttpRequest } from "./action";
import { type HttpFailure } from "./api-response";
import { type ResolutionTable } from "./resolution";

/**
 * コールバックもロガーも持たせない。TTY の行書き換えや React の再描画という片方にしかない
 * 表現が core に漏れ、NFR-6 が崩れる（C-4）。
 */
export type ExecuteContext = {
  projectKey: string;
  resolutions: ResolutionTable;
  get: (path: string) => Promise<unknown>;
  /**
   * 未解決の `HttpRequest` を渡さない。解決表を送信側にも配ることになり、解決の責任が
   * 二箇所に分かれる（§3.2）。
   */
  send: (request: ResolvedHttpRequest) => Promise<unknown>;
};

export type ExecutionEvent =
  | { type: "started"; total: number }
  | { type: "actionStarted"; index: number; total: number; action: Action }
  | {
      type: "actionSucceeded";
      action: Action;
      response: unknown;
      resolved: { ref: ProvidedRef; id: number }[];
    }
  | ({ type: "actionFailed"; action: Action } & HttpFailure)
  | { type: "waiting"; seconds: number }
  | { type: "finished" }
  | { type: "aborted"; applied: Action[]; failed: Action; pending: Action[] };
