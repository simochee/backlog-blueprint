import { type Action } from "../action";
import { resolvePath } from "../ref";
import { type ResolutionTable } from "../resolution";

export type ActionFailure = {
  action: Action;
  /** `0` などで埋めない。消費側は有無で「拒否された」と「届かなかった」を分ける（§3.3） */
  status?: number;
  errors: { message: string }[];
};

export type ApplyOutcome =
  | { result: "succeeded"; applied: Action[] }
  | { result: "rejected" }
  | { result: "aborted"; applied: Action[]; failed: ActionFailure; pending: Action[] };

export type ApplyOptions = { resolutions?: ResolutionTable };

export const failedPath = (
  { path }: NonNullable<Action["request"]>,
  resolutions: ResolutionTable | undefined,
): string => {
  const resolved = resolutions === undefined ? undefined : resolvePath(path, resolutions);

  return resolved?.resolved === true ? resolved.value : path;
};
