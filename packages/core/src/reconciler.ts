import { type Action } from "./action";
import { type Manifest } from "./manifest";
import { type Phase, type ResourceKind } from "./resource";
import { type Snapshot } from "./snapshot";

export type ReadContext = {
  projectKey: string;
  snapshot: Snapshot;
  get: (path: string) => Promise<unknown>;
};

/**
 * HTTP クライアントを持たせない。1つ足すと FR-3.1 が型の保証から実装の注意事項に落ちる（C-2）。
 */
export type PlanContext = {
  manifest: Manifest;
  snapshot: Snapshot;
};

/**
 * apply を生やさない。Action[] に現れない API 呼び出しを書けてしまい、「plan に出ないのに
 * apply で起きる」の排除が各実装の行儀に依存する（C-1 / NFR-8）。
 *
 * plan() に Promise を返させない。read() を経由しない取得を書く余地が戻る。
 */
export type Reconciler<Desired, ResourceSnapshot> = {
  readonly kind: ResourceKind;
  readonly phase: Phase;

  read(ctx: ReadContext): Promise<ResourceSnapshot>;

  plan(desired: Desired, snapshot: ResourceSnapshot, ctx: PlanContext): Action[];
};
