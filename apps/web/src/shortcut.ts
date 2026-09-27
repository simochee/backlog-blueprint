export type ShortcutKey = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
>;

const LATIN_LETTER = /^[a-z]$/iu;

/**
 * 物理キーを先に見ない。Dvorak では S の文字が別の物理キーにあり、ブラウザの Ctrl+S も
 * 文字の側で効く。物理キーに落とすのは、文字がラテン文字にならない配列のときだけ（WU-47）。
 */
const letterOf = ({ key, code }: ShortcutKey): string | undefined => {
  if (LATIN_LETTER.test(key)) {
    return key.toLowerCase();
  }

  return code.startsWith("Key") ? code.slice("Key".length).toLowerCase() : undefined;
};

export const isSaveShortcut = (event: ShortcutKey): boolean =>
  (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && letterOf(event) === "s";
