import { type ResourceKind } from "./resource";

export type ResolutionKey = `${ResourceKind}:${string}`;

export type ResolutionTable = Map<ResolutionKey, number>;

/**
 * 新規プロジェクトの既定リソースを、名前ではなく返ってきた順の枠で指す（§4.1 / RF-1）。
 * 表示名はスペースの言語設定で変わるので、名前では指せない。
 *
 * 利用者が `#0` という名前のリソースを書くと衝突する。`{$ref:<kind>:<name>}` の記法に
 * 脱出規則が無く（V-A22 と同じ事情）、名前空間を分ける手段がこの記法に無いため、
 * 衝突しにくい表記を選ぶところまでしかできない。
 */
export const defaultSlotName = (slot: number): string => `#${slot}`;
