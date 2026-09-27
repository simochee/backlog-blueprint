/** `remaining` だけにしない。`reset` は X-4 の待機が、`limit` は V-B8 の警告が使う。 */
export type RateLimit = { limit: number; remaining: number; reset: number };

export type Snapshot = {
  executor: { id: number; roleType: number };
  updateRateLimit: RateLimit;
  /**
   * 課題件数を `number | undefined` にしない。「取得に失敗したので判定をスキップする」が
   * 書けてしまい、V-B3 のゲートが開いたまま apply に進む（VP-5）。
   */
  project: { exists: false } | { exists: true; id: number; issueCount: number };
};
