export type Snapshot = {
  executor: { id: number; roleType: number }
  updateRateLimitRemaining: number
  /**
   * 課題件数を number | undefined にしない（VP-5）。省略可能にすると
   * 「取得に失敗したので判定をスキップする」が書けてしまい、破壊的操作を止める
   * 唯一のゲート（V-B3）が開いたまま apply に進む。
   * 未作成のプロジェクトには課題が存在しえないので、件数の有無は exists で分ける。
   */
  project: { exists: false } | { exists: true; id: number; issueCount: number }
}
