/**
 * 読む順がそのまま優先順。Radix の既定色を Catppuccin が上書きし、最後に自前の
 * 等幅パネルとステッパーが乗る。逆にすると計画の桁が Radix 側の指定で崩れる。
 */
import "@radix-ui/themes/styles.css";
import "./catppuccin.css";
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
