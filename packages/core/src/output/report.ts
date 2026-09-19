import { type Action } from "../action";
import { type Diagnostic } from "../diagnostic";
import { type ResourceOrder } from "../resulting-order";

/**
 * 描画の側で同じ形を書き直さない。`resultingOrder` は V-A15 が判定する値そのもの
 * （plan の出力仕様 §1.4）で、2つに分かれると片方だけにリソースが増える。
 */
export type ResultingOrder = ResourceOrder;

/**
 * `space` と `project` を持たない（§2.3）。`validate` は Backlog に一切アクセスせず
 * （CL-1）、プロジェクトが存在するかどうかも知らない。
 */
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
  resultingOrder: ResultingOrder;
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

/**
 * 差分の有無を `create` などの件数から決めない。定義は「`writeRequest: true` の
 * Action が 0 件」である（§1.3）。`refresh` が単独で出ることは無いので、
 * この定義と件数からの判定が食い違う場面も無い。
 */
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

/** 実行される Action。`noop` を除き `refresh` を含む（§1.3） */
export const executedActions = (actions: Action[]): Action[] =>
  actions.filter(({ op }) => op !== "noop");
