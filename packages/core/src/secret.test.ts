import { describe, expect, it } from 'vitest'

import { Secret } from './secret'

describe('${ENV} から展開された値', () => {
  it('文字列化するとマスクされる', () => {
    const value = new Secret('https://hooks.example.test/T000/B000')

    expect(String(value)).toBe('***')
  })

  it('文字列に連結してもマスクされる', () => {
    const value = new Secret('https://hooks.example.test/T000/B000')

    expect(`hookUrl ${value}`).toBe('hookUrl ***')
  })

  it('JSON 化しても実値が現れない', () => {
    const value = new Secret('https://hooks.example.test/T000/B000')

    expect(JSON.stringify(value)).toBe('"***"')
  })

  it('リクエストのパラメータに埋め込んだまま JSON 化しても実値が現れない', () => {
    const params = { name: 'Slack 通知', hookUrl: new Secret('https://hooks.example.test/T000/B000') }

    expect(JSON.stringify({ params })).toBe('{"params":{"name":"Slack 通知","hookUrl":"***"}}')
  })

  it('プロパティを列挙しても実値が現れない', () => {
    const value = new Secret('https://hooks.example.test/T000/B000')

    expect(Object.keys(value)).toEqual([])
    expect(JSON.stringify(Object.entries(value))).toBe('[]')
  })

  it('実値を取り出せるのは reveal を呼んだときだけ', () => {
    const value = new Secret('https://hooks.example.test/T000/B000')

    expect(value.reveal()).toBe('https://hooks.example.test/T000/B000')
  })
})
