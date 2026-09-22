import { type Action, type ProvidedRef, type ResolvedHttpRequest } from "./action";
import { type ResolutionTable } from "./resolution";

/**
 * コールバックもロガーも持たせない（C-4）。進捗は AsyncIterable<ExecutionEvent> だけで表す。
 * 描画の手がかりを1つでも渡せるようにすると、TTY の行書き換えと React の再描画という
 * 片方にしかない表現が core に漏れ、NFR-6 が崩れる。
 */
export type ExecuteContext = {
  projectKey: string;
  resolutions: ResolutionTable;
  get: (path: string) => Promise<unknown>;
  /**
   * 受け取るのは Ref が解決済みのリクエストである。解決表を持つのは実行側（§3.2）なので、
   * path と params の Ref を潰すのは Executor の仕事。送信側に HttpRequest を渡すと、
   * 解決表を送信側にも配ることになり、解決の責任が二箇所に分かれる。
   *
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
  /**
   * status は任意である（plan の出力仕様 §3.3）。タイムアウト・名前解決の失敗・
   * ブラウザの CORS 失敗では HTTP のやり取りが成立せず、ステータスが存在しない。
   * `0` などの偽の値で埋めない。埋めると消費側が「Backlog が拒否した」と
   * 「Backlog に届かなかった」を区別できなくなる。未解決の Ref を偽の ID で
   * 埋めないこと（PO-5）と同じで、無い値は無いまま表す。
   */
  | { type: "actionFailed"; action: Action; status?: number; errors: { message: string }[] }
  | { type: "waiting"; seconds: number }
  | { type: "finished" }
  | { type: "aborted"; applied: Action[]; failed: Action; pending: Action[] };
