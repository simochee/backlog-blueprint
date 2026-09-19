import { type SecretRevisions } from "./secrets";

export type Inputs = { space: string; manifestText: string; revisions: SecretRevisions };

export type Derived<T> = { stamp: string; value: T };

/**
 * 秘匿値そのものを畳み込まない（§2.4）。書き換えの回数だけで「変わった」は言えるので、
 * 値を持ち回す必要が無い。
 */
export const connectionStamp = ({ space, revisions }: Inputs): string =>
  JSON.stringify([space, revisions.credentials]);

export const manifestStamp = ({ manifestText, revisions }: Inputs): string =>
  JSON.stringify([manifestText, revisions.environment]);

export const planStamp = (inputs: Inputs): string =>
  JSON.stringify([connectionStamp(inputs), manifestStamp(inputs)]);

/**
 * 算出済みのものを入力の派生状態として読む（WU-3 / WU-4）。破棄を入力のハンドラに
 * 書く形だと、ハンドラが1つ増えるたびに破棄を書き足すことになり、1つ漏れた瞬間に
 * 「見た計画と違うものが適用される」が起きる。ここを通さないと値を取り出せない形に
 * しておけば、入力が変わった計画は取り出せないものになる。
 */
export const fresh = <T>(derived: Derived<T> | undefined, stamp: string): T | undefined =>
  derived?.stamp === stamp ? derived.value : undefined;

export type Mark = string | undefined;

/**
 * 値を持たない状態（確認ダイアログが開いているか、その計画を apply が使い切ったか）も
 * 印に紐づける（WU-3）。真偽値で持つと入力が変わっても真のまま残り、計画を取り直した
 * 瞬間に蘇る。
 */
export const marked = (mark: Mark, stamp: string): boolean => mark === stamp;
