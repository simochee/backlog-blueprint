import { describe, expect, it } from 'vitest'

import { embedRef, resolutionKey, resolvePath } from './ref'
import type { ResolutionTable } from './resolution'
import type { Ref } from './value'

const otherIssueType: Ref = { $ref: { kind: 'issueType', name: 'その他' } }

describe('path に埋め込まれた参照', () => {
  it('plan の出力仕様に載っている表記で埋め込まれる', () => {
    const path = `/api/v2/projects/PROJ_A/issueTypes/${embedRef(otherIssueType)}`

    expect(path).toBe('/api/v2/projects/PROJ_A/issueTypes/{$ref:issueType:その他}')
  })

  it('埋め込みと解決表のキーは同じ組み立てから作られる', () => {
    expect(embedRef(otherIssueType)).toBe(`{$ref:${resolutionKey(otherIssueType)}}`)
  })

  it('埋め込んだ参照は解決表の ID に置き換わる', () => {
    const resolutions: ResolutionTable = new Map([['issueType:その他', 1234]])

    const result = resolvePath(
      `/api/v2/projects/PROJ_A/issueTypes/${embedRef(otherIssueType)}`,
      resolutions,
    )

    expect(result).toEqual({ resolved: true, value: '/api/v2/projects/PROJ_A/issueTypes/1234' })
  })

  it('参照を含まない path はそのまま返る', () => {
    const result = resolvePath('/api/v2/projects/PROJ_A/issueTypes', new Map())

    expect(result).toEqual({ resolved: true, value: '/api/v2/projects/PROJ_A/issueTypes' })
  })

  it('1つの path にある参照はすべて置き換わる', () => {
    const resolutions: ResolutionTable = new Map([
      ['project:プロジェクトA', 7],
      ['webhook:Slack 通知', 42],
    ])

    const result = resolvePath(
      `/api/v2/projects/${embedRef({ $ref: { kind: 'project', name: 'プロジェクトA' } })}/webhooks/${embedRef({ $ref: { kind: 'webhook', name: 'Slack 通知' } })}`,
      resolutions,
    )

    expect(result).toEqual({ resolved: true, value: '/api/v2/projects/7/webhooks/42' })
  })

  it('解決表に無い参照は失敗として返り、置き換えた path は返らない', () => {
    const result = resolvePath(
      `/api/v2/projects/PROJ_A/issueTypes/${embedRef(otherIssueType)}`,
      new Map(),
    )

    expect(result).toEqual({ resolved: false, unresolved: [otherIssueType] })
  })

  it('解決できない参照は取りこぼさずすべて列挙される', () => {
    const bug: Ref = { $ref: { kind: 'issueType', name: 'バグ' } }
    const resolutions: ResolutionTable = new Map([['issueType:その他', 1234]])

    const result = resolvePath(
      `/${embedRef(otherIssueType)}/${embedRef(bug)}/${embedRef({ $ref: { kind: 'status', name: 'レビュー中' } })}`,
      resolutions,
    )

    expect(result).toEqual({
      resolved: false,
      unresolved: [bug, { $ref: { kind: 'status', name: 'レビュー中' } }],
    })
  })

  it('リソース種別として知られていない語は参照として扱わない', () => {
    const result = resolvePath('/api/v2/{$ref:issue:1}', new Map())

    expect(result).toEqual({ resolved: true, value: '/api/v2/{$ref:issue:1}' })
  })

  it('リネームで旧名のエントリが消えていれば、旧名を指す参照は解決しない', () => {
    const resolutions: ResolutionTable = new Map([['issueType:調査', 1234]])

    const result = resolvePath(embedRef(otherIssueType), resolutions)

    expect(result).toEqual({ resolved: false, unresolved: [otherIssueType] })
  })
})
