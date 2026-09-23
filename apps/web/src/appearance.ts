import { useSyncExternalStore } from "react";

const QUERY = "(prefers-color-scheme: dark)";

/**
 * `matchMedia` の有無を確かめる。happy-dom で走るテストと、埋め込まれた WebView が
 * これを持たないことがあり、持たない環境で落ちると画面全体が描画されない。
 * 配色の話で画面を失うのは割に合わない。
 */
const media = (): MediaQueryList | undefined =>
  typeof globalThis.matchMedia === "function" ? globalThis.matchMedia(QUERY) : undefined;

const subscribe = (onChange: () => void): (() => void) => {
  const query = media();

  query?.addEventListener("change", onChange);

  return () => query?.removeEventListener("change", onChange);
};

export const useAppearance = (): "light" | "dark" =>
  useSyncExternalStore(
    subscribe,
    () => (media()?.matches === true ? "dark" : "light"),
    () => "light" as const,
  );
