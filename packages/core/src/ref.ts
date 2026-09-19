import type { HttpRequest, ResolvedHttpRequest } from './action'
import type { ResolutionKey, ResolutionTable } from './resolution'
import { RESOURCE_KINDS } from './resource'
import { Secret } from './secret'
import type { Ref, ResolvedValue, Value } from './value'

export type ResolveResult<T> =
  | { resolved: true; value: T }
  | { resolved: false; unresolved: Ref[] }

/**
 * 埋め込み表記の生成と解析を同じ場所に置き、解決表のキーも同じ関数から作る。
 * 別々に書けるようにすると、path を組む側とキーを引く側で表記がずれても
 * 型検査では気付けず、解決できない Ref という形でしか現れない。
 *
 * 名前に `}` を含むリソースは往復できない。表記は
 * plan の出力仕様 §2.1 の例が唯一の出所で、そこに脱出規則が無い以上、
 * 独自に発明すると出力仕様と食い違う。
 */
const EMBEDDED_REF = /\{\$ref:([^:}]+):([^}]*)\}/g

export const resolutionKey = ({ $ref }: Ref): ResolutionKey => `${$ref.kind}:${$ref.name}`

export const embedRef = (ref: Ref): string => `{$ref:${resolutionKey(ref)}}`

export const resolveRef = (ref: Ref, resolutions: ResolutionTable): number | undefined =>
  resolutions.get(resolutionKey(ref))

export const resolvePath = (path: string, resolutions: ResolutionTable): ResolveResult<string> => {
  const unresolved: Ref[] = []

  const value = path.replace(EMBEDDED_REF, (embedded, rawKind: string, name: string) => {
    const kind = RESOURCE_KINDS.find((candidate) => candidate === rawKind)

    if (kind === undefined) {
      return embedded
    }

    const ref: Ref = { $ref: { kind, name } }
    const id = resolveRef(ref, resolutions)

    if (id === undefined) {
      unresolved.push(ref)
      return embedded
    }

    return String(id)
  })

  return unresolved.length === 0 ? { resolved: true, value } : { resolved: false, unresolved }
}

const resolveValue = (
  value: Value,
  resolutions: ResolutionTable,
  unresolved: Ref[],
): ResolvedValue => {
  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item, resolutions, unresolved))
  }

  if (value instanceof Secret || typeof value !== 'object' || value === null) {
    return value
  }

  const id = resolveRef(value, resolutions)

  if (id === undefined) {
    unresolved.push(value)
    return null
  }

  return id
}

export const resolveRequest = (
  request: HttpRequest,
  resolutions: ResolutionTable,
): ResolveResult<ResolvedHttpRequest> => {
  const unresolved: Ref[] = []
  const path = resolvePath(request.path, resolutions)
  const params = Object.fromEntries(
    Object.entries(request.params).map(([field, value]) => [
      field,
      resolveValue(value, resolutions, unresolved),
    ]),
  )

  if (!path.resolved) {
    return { resolved: false, unresolved: [...path.unresolved, ...unresolved] }
  }

  if (unresolved.length > 0) {
    return { resolved: false, unresolved }
  }

  return { resolved: true, value: { method: request.method, path: path.value, params } }
}
