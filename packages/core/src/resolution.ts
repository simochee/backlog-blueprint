import type { ResourceKind } from './resource'

export type ResolutionTable = Map<`${ResourceKind}:${string}`, number>
