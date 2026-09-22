/**
 * 印ごとに、その印が従う入力だけを受け取る。1つの型にまとめて渡す形にすると、
 * マニフェストの印が API キーの書き換え回数まで見えるところに置かれ、検証を
 * 打鍵ごとにやり直させる結び付きが型からは見えないまま入り込む。
 *
 * API キーや環境変数の入力値そのものは畳み込まない（§2.4）。書き換えの回数だけで「変わった」は言えるので、
 * 値を持ち回す必要が無い。
 */
export type ConnectionInputs = { space: string; credentials: number };

export type ManifestInputs = { manifestText: string; environment: number };

export type Derived<T> = { stamp: string; value: T };

export const connectionStamp = ({ space, credentials }: ConnectionInputs): string =>
  JSON.stringify([space, credentials]);

export const manifestStamp = ({ manifestText, environment }: ManifestInputs): string =>
  JSON.stringify([manifestText, environment]);

export const planStamp = (connection: string, manifest: string): string =>
  JSON.stringify([connection, manifest]);

/**
 * 算出済みのものを入力の派生状態として読む（WU-3 / WU-4）。破棄を入力のハンドラに
 * 書く形だと、ハンドラが1つ増えるたびに破棄を書き足すことになり、1つ漏れた瞬間に
 * 「見た計画と違うものが適用される」が起きる。ここを通さないと値を取り出せない形に
 * しておけば、入力が変わった計画は取り出せないものになる。
 */
export const fresh = <T>(derived: Derived<T> | undefined, stamp: string): T | undefined =>
  derived?.stamp === stamp ? derived.value : undefined;
