/**
 * 接続の番号まで1つの型にまとめない。マニフェストの印から見えると、検証を接続のたびに
 * やり直させる結び付きが型に現れないまま入り込む。環境変数は値ではなく書き換えの回数を持つ（§2.4）。
 */
export type ManifestInputs = { manifestText: string; environment: number };

export type Derived<T> = { stamp: string; value: T };

/** フォームの入力値に付けない。切り替えのモーダルに1文字打った時点で今の接続と計画が無効になる（WU-36） */
export const connectionStamp = (sessionId: number | undefined): string =>
  JSON.stringify(["connection", sessionId ?? null]);

export const manifestStamp = ({ manifestText, environment }: ManifestInputs): string =>
  JSON.stringify([manifestText, environment]);

export const planStamp = (connection: string, manifest: string): string =>
  JSON.stringify([connection, manifest]);

/**
 * 破棄を入力のハンドラに書かない。ハンドラが増えるたびに書き足すことになり、1つ漏れた瞬間に
 * 見た計画と違うものが適用される（WU-3 / WU-4）。
 */
export const fresh = <T>(derived: Derived<T> | undefined, stamp: string): T | undefined =>
  derived?.stamp === stamp ? derived.value : undefined;
