import { formatForDisplay } from "@tanstack/react-hotkeys";

/**
 * 物理キー（`Mod+[KeyS]`）で書かない。Dvorak では S の文字が別の物理キーにあり、ブラウザの保存も
 * 文字の側で効く。文字で書けば、ラテン文字でない配列のときだけ物理キーに落ちる（WU-47）。
 * `Control` で揃えない。macOS の入力欄では Ctrl+B や Ctrl+O がカーソル移動に使われている（WU-58）。
 */
export const SHORTCUTS = {
  save: "Mod+S",
  open: "Mod+O",
  plan: "Mod+Enter",
  panel: "Mod+J",
  sidebar: "Mod+B",
} as const;

export const shortcutLabel = (hotkey: string): string => formatForDisplay(hotkey);
