/**
 * Radix のスタイルを先に読む。後勝ちなので、逆にすると styles.css の等幅指定が
 * テーマ側の指定に上書きされ、計画の桁が崩れる。
 */
import "@radix-ui/themes/styles.css";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";

const container = document.querySelector("#app");

if (container === null) {
  throw new TypeError("#app is missing from the document");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
