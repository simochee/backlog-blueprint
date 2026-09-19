import type { Action } from './action'
import type { Phase, ResourceKind } from './resource'
import type { Snapshot } from './snapshot'

export type ReadContext = {
  projectKey: string
  snapshot: Snapshot
  get: (path: string) => Promise<unknown>
}

/**
 * HTTP クライアントを持たせない（C-2）。計画に要る GET は read() で出し切る決まりで、
 * ここに fetch を1つ足すと FR-3.1（plan は GET しか行わない）が型の保証から
 * 実装の注意事項に落ちる。
 */
export type PlanContext<ManifestShape = unknown> = {
  manifest: ManifestShape
  snapshot: Snapshot
}

/**
 * apply を生やさない（C-1）。適用は Action[] に対して共通の Executor が行う。
 * reconciler が適用を持つと Action[] に現れない API 呼び出しを書けてしまい、
 * 「plan に出ないのに apply で起きる」の排除が各実装の行儀に依存する（NFR-8）。
 *
 * plan() は Promise を返さない。非同期にできると read() を経由しない取得を
 * 書く余地が戻ってくる。
 */
export interface Reconciler<Desired, ResourceSnapshot, ManifestShape = unknown> {
  readonly kind: ResourceKind
  readonly phase: Phase

  read(ctx: ReadContext): Promise<ResourceSnapshot>

  plan(desired: Desired, snapshot: ResourceSnapshot, ctx: PlanContext<ManifestShape>): Action[]
}
