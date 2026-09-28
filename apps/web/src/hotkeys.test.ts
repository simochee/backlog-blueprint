import { matchesKeyboardEvent } from "@tanstack/react-hotkeys";
import { describe, expect, it } from "vite-plus/test";

import { SHORTCUTS } from "./hotkeys";

type Press = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "isComposing"
>;

const press = (input: Partial<Press>): KeyboardEvent =>
  ({
    key: "s",
    code: "KeyS",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    getModifierState: () => false,
    ...input,
  }) as unknown as KeyboardEvent;

const saves = (event: KeyboardEvent, platform: "mac" | "linux"): boolean =>
  matchesKeyboardEvent(event, SHORTCUTS.save, platform);

describe("保存のショートカット", () => {
  it("macOS では Cmd+S、それ以外では Ctrl+S が保存", () => {
    expect(saves(press({ metaKey: true }), "mac")).toBe(true);
    expect(saves(press({ ctrlKey: true }), "linux")).toBe(true);
  });

  it("macOS の Ctrl+S は入力欄のカーソル移動に残す", () => {
    expect(saves(press({ ctrlKey: true }), "mac")).toBe(false);
  });

  it("修飾キーの無い S は保存ではない", () => {
    expect(saves(press({}), "linux")).toBe(false);
  });

  it("Shift や Alt を足した組み合わせは保存ではない", () => {
    expect(saves(press({ key: "S", ctrlKey: true, shiftKey: true }), "linux")).toBe(false);
    expect(saves(press({ key: "ß", ctrlKey: true, altKey: true }), "linux")).toBe(false);
  });

  it("Caps Lock で大文字になっていても保存", () => {
    expect(saves(press({ key: "S", metaKey: true }), "mac")).toBe(true);
  });

  it("文字で見るので、Dvorak で S の物理キーを押しても o なら保存ではなく、S の文字なら保存", () => {
    expect(saves(press({ key: "o", code: "KeyS", metaKey: true }), "mac")).toBe(false);
    expect(saves(press({ key: "s", code: "Semicolon", metaKey: true }), "mac")).toBe(true);
  });

  it("ラテン文字にならない配列では、S の物理キーで保存", () => {
    expect(saves(press({ key: "ы", code: "KeyS", ctrlKey: true }), "linux")).toBe(true);
    expect(saves(press({ key: "в", code: "KeyD", ctrlKey: true }), "linux")).toBe(false);
  });
});
