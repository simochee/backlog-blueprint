import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * 後片付けを testing-library の自動登録に任せない。自動登録は `afterEach` が
 * グローバルに居るときだけ働き、`test.globals` を立てていないこの設定では働かない。
 * 消すと、前のテストが描いた DOM が次のテストに残り、`getBy*` が複数一致で落ちる。
 */
afterEach(cleanup);
