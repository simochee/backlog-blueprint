import { useSyncExternalStore } from "react";

const QUERY = "(prefers-color-scheme: dark)";

/** `matchMedia` があると決めつけない。happy-dom や埋め込みの WebView には無く、落ちると画面全体が消える */
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
