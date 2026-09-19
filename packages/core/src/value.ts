import type { ResourceKind } from './resource'
import type { Secret } from './secret'

export type Ref = { $ref: { kind: ResourceKind; name: string } }

export type Value = string | number | boolean | null | Secret | Ref | Value[]

export type ResolvedValue = string | number | boolean | null | Secret | ResolvedValue[]

export type IdOrRef = number | Ref
