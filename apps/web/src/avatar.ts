/**
 * 文字単位で切り出す。`name[0]` だとサロゲートペアの片割れになり、絵文字や一部の漢字で
 * 化けた1文字が出る。
 */
export const initialOf = (name: string): string => [...name.trim()][0]?.toLocaleUpperCase() ?? "?";
