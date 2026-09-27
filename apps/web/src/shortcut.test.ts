import { describe, expect, it } from "vitest";

import { isSaveShortcut, type ShortcutKey } from "./shortcut";

const press = (input: Partial<ShortcutKey>): ShortcutKey => ({
  key: "s",
  code: "KeyS",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...input,
});

describe("保存のショートカット", () => {
  it("Cmd+S と Ctrl+S は保存", () => {
    expect(isSaveShortcut(press({ metaKey: true }))).toBe(true);
    expect(isSaveShortcut(press({ ctrlKey: true }))).toBe(true);
  });

  it("修飾キーの無い S は保存ではない", () => {
    expect(isSaveShortcut(press({}))).toBe(false);
  });

  it("Shift や Alt を足した組み合わせは保存ではない", () => {
    expect(isSaveShortcut(press({ key: "S", metaKey: true, shiftKey: true }))).toBe(false);
    expect(isSaveShortcut(press({ key: "ß", ctrlKey: true, altKey: true }))).toBe(false);
  });

  it("Caps Lock で大文字になっていても保存", () => {
    expect(isSaveShortcut(press({ key: "S", metaKey: true }))).toBe(true);
  });

  it("文字で見るので、Dvorak で S の物理キーを押しても o なら保存ではなく、S の文字なら保存", () => {
    expect(isSaveShortcut(press({ key: "o", code: "KeyS", metaKey: true }))).toBe(false);
    expect(isSaveShortcut(press({ key: "s", code: "Semicolon", metaKey: true }))).toBe(true);
  });

  it("ラテン文字にならない配列では、S の物理キーで保存", () => {
    expect(isSaveShortcut(press({ key: "ы", code: "KeyS", ctrlKey: true }))).toBe(true);
    expect(isSaveShortcut(press({ key: "в", code: "KeyD", ctrlKey: true }))).toBe(false);
  });
});
