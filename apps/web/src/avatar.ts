/** `name[0]` にしない。サロゲートペアの片割れになり、絵文字や一部の漢字で化けた1文字が出る */
export const initialOf = (name: string): string => [...name.trim()][0]?.toLocaleUpperCase() ?? "?";
