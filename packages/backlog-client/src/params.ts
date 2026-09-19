import { Secret, type ResolvedValue } from "@backlog-blueprint/core";

const revealed = (value: ResolvedValue): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => revealed(item));
  }

  return value instanceof Secret ? value.reveal() : value;
};

/**
 * `reveal()` を呼ぶ唯一の場所（§2.4）。ここから先はシリアライズだけで、Secret のまま
 * 渡すと `toString()` のマスクがそのまま本文に載る。呼ぶ場所をもう1つ作れば、
 * その区間を生値が裸で流れる。
 *
 * 値の形は変えずに渡す。boolean や `null` や空配列をここで文字列に畳むと、
 * 送信層が「素通しのトランスポート」であることをやめ、`Action.request` が
 * 実際に飛ぶリクエストでなくなる（PO-3）。
 */
export const revealParams = (params: Record<string, ResolvedValue>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(params).map(([key, value]) => [key, revealed(value)]));
