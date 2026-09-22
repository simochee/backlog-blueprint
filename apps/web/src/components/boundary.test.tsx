import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { Panel } from "./panel";

const SECRET = "https://hooks.example.com/must-never-be-rendered";

const Throws = (): never => {
  throw new TypeError(`cannot read the manifest at ${SECRET}`);
};

/**
 * React は受け止めた例外を console にも報告する。落ちることを確かめるテストなので、
 * その報告まで出力に混ぜない。
 */
let reported: MockInstance<typeof console.error>;

beforeEach(() => {
  reported = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  reported.mockRestore();
});

describe("段の中で落ちたとき", () => {
  it("落ちた段は差し替わり、他の段は残る", () => {
    render(
      <>
        <Panel enabled step={1} title="Connect">
          <Throws />
        </Panel>
        <Panel enabled step={2} title="Manifest">
          <p>still here</p>
        </Panel>
      </>,
    );

    expect(screen.getByText(/This step stopped working/)).toBeInTheDocument();
    expect(screen.getByText("still here")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  /** 描画中の例外はマニフェストの断片を持ちうる。そこには展開済みの値が入っている（§2.4）。 */
  it("受け止めた内容は画面に出さない", () => {
    render(
      <Panel enabled step={1} title="Connect">
        <Throws />
      </Panel>,
    );

    expect(document.body.textContent).not.toContain(SECRET);
    expect(document.body.textContent).not.toContain("cannot read the manifest");
  });
});
