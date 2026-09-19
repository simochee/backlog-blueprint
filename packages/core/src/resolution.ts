import type { ResourceKind } from './resource'

export type ResolutionKey = `${ResourceKind}:${string}`

export type ResolutionTable = Map<ResolutionKey, number>
