const graphemes = new Intl.Segmenter();

/**
 * `name[0]` や `[...name][0]` にしない。前者はサロゲートペアの片割れを、後者は ZWJ でつないだ
 * 絵文字の最初の部品だけを取り出し、化けた1文字や別の絵文字が出る。
 */
export const initialOf = (name: string): string => {
  const [first] = graphemes.segment(name.trim());

  return first?.segment.toLocaleUpperCase() ?? "?";
};
