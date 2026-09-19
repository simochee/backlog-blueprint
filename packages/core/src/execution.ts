import type { Action, HttpRequest, ProvidedRef } from './action'
import type { ResolutionTable } from './resolution'

/**
 * コールバックもロガーも持たせない（C-4）。進捗は AsyncIterable<ExecutionEvent> だけで表す。
 * 描画の手がかりを1つでも渡せるようにすると、TTY の行書き換えと React の再描画という
 * 片方にしかない表現が core に漏れ、NFR-6 が崩れる。
 */
export type ExecuteContext = {
  projectKey: string
  resolutions: ResolutionTable
  get: (path: string) => Promise<unknown>
  send: (request: HttpRequest) => Promise<unknown>
}

export type ExecutionEvent =
  | { type: 'started'; total: number }
  | { type: 'actionStarted'; index: number; total: number; action: Action }
  | {
      type: 'actionSucceeded'
      action: Action
      response: unknown
      resolved: Array<{ ref: ProvidedRef; id: number }>
    }
  | { type: 'actionFailed'; action: Action; status: number; errors: Array<{ message: string }> }
  | { type: 'waiting'; seconds: number }
  | { type: 'finished' }
  | { type: 'aborted'; applied: Action[]; failed: Action; pending: Action[] }
