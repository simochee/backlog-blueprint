import { useSyncExternalStore } from "react";

export type Page = "apply" | "export";

export const PAGES: { page: Page; title: string; hash: string }[] = [
  { page: "apply", title: "Apply", hash: "#/" },
  { page: "export", title: "Export", hash: "#/export" },
];

export const PAGE_INTROS: Record<Page, { title: string; description: string }> = {
  apply: {
    title: "Apply a manifest",
    description: "Declare a Backlog project in YAML, review the plan, then apply it.",
  },
  export: {
    title: "Export a project",
    description:
      "Write an existing project out as a manifest, so a template can start from a project that already works.",
  },
};

/** 知らないハッシュは Apply に倒す。貼られた古いリンクや打ち間違いで白い画面を出さない。 */
export const pageOf = (hash: string): Page =>
  PAGES.find((entry) => entry.hash === hash)?.page ?? "apply";

const subscribe = (onChange: () => void): (() => void) => {
  globalThis.addEventListener("hashchange", onChange);

  return () => {
    globalThis.removeEventListener("hashchange", onChange);
  };
};

const currentPage = (): Page => pageOf(globalThis.location.hash);

/** WU-1。ページだけを URL に持つ。ステップや入力は載せない。 */
export const usePage = (): Page => useSyncExternalStore(subscribe, currentPage);
