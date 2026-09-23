import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { SectionBoundary } from "./boundary";

const Throws = (): never => {
  throw new TypeError("cannot read properties of undefined");
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

describe("領域の中で落ちたとき", () => {
  it("落ちた領域は差し替わり、他の領域は残る", () => {
    render(
      <>
        <SectionBoundary>
          <Throws />
        </SectionBoundary>
        <SectionBoundary>
          <p>still here</p>
        </SectionBoundary>
      </>,
    );

    expect(screen.getByText(/This section stopped working/)).toBeInTheDocument();
    expect(screen.getByText("still here")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("受け止めた内容は画面に出さない", () => {
    render(
      <SectionBoundary>
        <Throws />
      </SectionBoundary>,
    );

    expect(document.body.textContent).not.toContain("cannot read properties of undefined");
  });
});
