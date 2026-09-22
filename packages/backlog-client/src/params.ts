import { type ResolvedValue } from "@backlog-blueprint/core";

/**
 * 空の配列だけは形を変えて渡す。`qs` は空配列をキーごと落とすので、そのままでは
 * `applicableIssueTypes[]=`（絞りの解除）が本文に現れないまま apply が成功し、
 * 次の plan でも同じ差分が出続ける（API 制約「空配列を送る方法」）。
 */
const EMPTY_ARRAY = [""];

const prepared = (value: ResolvedValue): unknown => {
  if (Array.isArray(value)) {
    return value.length === 0 ? EMPTY_ARRAY : value.map((item) => prepared(item));
  }

  return value;
};

/** 空配列だけ送信層が表現できる形にする（API 制約「空配列を送る方法」）。 */
export const prepareParams = (params: Record<string, ResolvedValue>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(params).map(([key, value]) => [key, prepared(value)]));
