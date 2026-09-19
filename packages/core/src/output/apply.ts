import { type Action } from "../action";
import { type ResolutionTable } from "../resolution";

export type ActionFailure = {
  action: Action;
  /**
   * HTTP のやり取りが成立しなかった失敗では無い（§3.3 / core §7.0）。
   * 消費側はこの有無で「Backlog が拒否した」と「Backlog に届かなかった」を判別する。
   */
  status?: number;
  errors: { message: string }[];
};

export type ApplyOutcome =
  | { result: "succeeded"; applied: Action[] }
  | { result: "rejected" }
  | { result: "aborted"; applied: Action[]; failed: ActionFailure; pending: Action[] };

/**
 * 解決表を受け取るのは、失敗したリクエストの path を実 ID で示すため（§3.2）。
 * `Action.request.path` は `{$ref:...}` を含みうる。
 */
export type ApplyOptions = { resolutions?: ResolutionTable };
