import { Secret, type ResolvedValue } from "@backlog-blueprint/core";

/**
 * 空の配列だけは形を変えて渡す。`qs` は空配列をキーごと落とすので、そのままでは
 * `applicableIssueTypes[]=`（絞りの解除）が本文に現れないまま apply が成功し、
 * 次の plan でも同じ差分が出続ける（API 制約「空配列を送る方法」）。
 */
const EMPTY_ARRAY = [""];

const revealed = (value: ResolvedValue): unknown => {
  if (Array.isArray(value)) {
    return value.length === 0 ? EMPTY_ARRAY : value.map((item) => revealed(item));
  }

  return value instanceof Secret ? value.reveal() : value;
};

/**
 * `reveal()` を呼ぶ唯一の場所（§2.4）。ここから先はシリアライズだけで、Secret のまま
 * 渡すと `toString()` のマスクがそのまま本文に載る。呼ぶ場所をもう1つ作れば、
 * その区間を生値が裸で流れる。
 *
 * 値の形は変えずに渡す。boolean や `null` をここで文字列に畳むと、送信層が
 * 「素通しのトランスポート」であることをやめ、`Action.request` が実際に飛ぶ
 * リクエストでなくなる（PO-3）。空配列だけが例外で、理由は `revealed` に書いた。
 */
export const revealParams = (params: Record<string, ResolvedValue>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(params).map(([key, value]) => [key, revealed(value)]));
