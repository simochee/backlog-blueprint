import { type Action } from "../action";
import { type Diagnostic } from "../diagnostic";
import { type ResourceOrder } from "../resulting-order";

/** `space` と `project` を持たない（§2.3）。`validate` は Backlog にアクセスしない（CL-1） */
export type ValidateReport = {
  tool: { name: string; version: string };
  manifest: { path: string };
  diagnostics: Diagnostic[];
};

export type PlanReport = {
  tool: { name: string; version: string };
  space: string;
  manifest: { path: string };
  project: { key: string; name: string; exists: boolean };
  diagnostics: Diagnostic[];
  actions: Action[];
  resultingOrder: ResourceOrder;
};

export type Summary = {
  hasChanges: boolean;
  create: number;
  update: number;
  delete: number;
  reorder: number;
  noop: number;
  writeRequests: number;
  estimatedSeconds: number;
};

const SECONDS_PER_WRITE_REQUEST = 1;

const count = (actions: Action[], op: Action["op"]): number =>
  actions.filter((action) => action.op === op).length;

/** 差分の有無を `create` などの件数から決めない。基準は `writeRequest`（§1.3） */
export const summarize = (actions: Action[]): Summary => {
  const writeRequests = actions.filter(({ writeRequest }) => writeRequest).length;

  return {
    hasChanges: writeRequests > 0,
    create: count(actions, "create"),
    update: count(actions, "update"),
    delete: count(actions, "delete"),
    reorder: count(actions, "reorder"),
    noop: count(actions, "noop"),
    writeRequests,
    estimatedSeconds: Math.ceil(writeRequests * SECONDS_PER_WRITE_REQUEST),
  };
};
