import type { Op, Phase, ResourceKind } from './resource'
import type { IdOrRef, Value } from './value'

export type ActionId = string

export type HttpRequest = {
  method: 'POST' | 'PATCH' | 'DELETE'
  path: string
  params: Record<string, Value>
}

export type Change = { field: string; before: Value | null; after: Value | null }

export type Note = { type: 'renamed'; from: string }

export type ProvidedRef = { kind: ResourceKind; name: string }

export type Action = {
  id: ActionId
  phase: Phase
  kind: ResourceKind
  op: Op
  name: string
  target?: IdOrRef
  request?: HttpRequest
  provides?: ProvidedRef[]
  changes?: Change[]
  notes?: Note[]
  writeRequest: boolean
}
