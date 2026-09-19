/**
 * 値は `GET /rateLimit` の本文をそのまま写す（X-3）。`reset` も本文と同じ Unix time の秒。
 * ブラウザは `access-control-expose-headers` が返らず `X-RateLimit-*` を読めないため、
 * Node だけヘッダから取ると「Web でだけ起きる不具合」ができる。
 *
 * `remaining` だけにしない。X-4 が「429 を受けたらリセット時刻まで待って再試行」と
 * 定めており、待つ先の時刻が要る。`limit` は V-B8 の警告に上限と残量の両方を
 * 書けるようにするため。
 */
export type RateLimit = { limit: number; remaining: number; reset: number }

export type Snapshot = {
  executor: { id: number; roleType: number }
  updateRateLimit: RateLimit
  /**
   * 課題件数を number | undefined にしない（VP-5）。省略可能にすると
   * 「取得に失敗したので判定をスキップする」が書けてしまい、破壊的操作を止める
   * 唯一のゲート（V-B3）が開いたまま apply に進む。
   * 未作成のプロジェクトには課題が存在しえないので、件数の有無は exists で分ける。
   */
  project: { exists: false } | { exists: true; id: number; issueCount: number }
}
