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
 * HTTP クライアントを持たせない（C-2）。計画に要る GET は read() で出し切る決まりで、
 * ここに fetch を1つ足すと FR-3.1（plan は GET しか行わない）が型の保証から
 * 実装の注意事項に落ちる。
 */
export type PlanContext = {
  manifest: Manifest;
  snapshot: Snapshot;
  /**
   * 包む対象を reconciler 側で列挙しない（E-4 / E-6）。キー名で列挙する形にすると
   * 対象の追加漏れがそのまま漏洩になるので、`${ENV}` 由来かどうかは S2 が集めた
   * path の集合にだけ聞く。
   */
  isSecret: (path: string) => boolean;
};

/**
 * apply を生やさない（C-1）。適用は Action[] に対して共通の Executor が行う。
 * reconciler が適用を持つと Action[] に現れない API 呼び出しを書けてしまい、
 * 「plan に出ないのに apply で起きる」の排除が各実装の行儀に依存する（NFR-8）。
 *
 * plan() は Promise を返さない。非同期にできると read() を経由しない取得を
 * 書く余地が戻ってくる。
 */
export type Reconciler<Desired, ResourceSnapshot> = {
  readonly kind: ResourceKind;
  readonly phase: Phase;

  read(ctx: ReadContext): Promise<ResourceSnapshot>;

  plan(desired: Desired, snapshot: ResourceSnapshot, ctx: PlanContext): Action[];
};
