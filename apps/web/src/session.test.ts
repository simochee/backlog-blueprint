import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forgetCredentials, readStoredCredentials, storeCredentials } from "./session";

const STORAGE_KEY = "backlog-blueprint:connection";

beforeEach(() => {
  globalThis.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("接続の資格情報の保存", () => {
  it("保存したスペースと API キーをそのまま読み戻せる", () => {
    storeCredentials({ space: "example.backlog.com", apiKey: "key" });

    expect(readStoredCredentials()).toEqual({ space: "example.backlog.com", apiKey: "key" });
  });

  it("消した後は何も読めない", () => {
    storeCredentials({ space: "example.backlog.com", apiKey: "key" });
    forgetCredentials();

    expect(readStoredCredentials()).toBeUndefined();
  });

  it("JSON として読めない値は保存が無いものとして扱う", () => {
    globalThis.sessionStorage.setItem(STORAGE_KEY, "{not json");

    expect(readStoredCredentials()).toBeUndefined();
  });

  it("形の合わない値は保存が無いものとして扱う", () => {
    globalThis.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ space: "x" }));

    expect(readStoredCredentials()).toBeUndefined();
  });

  it("ストレージが書き込みを拒んでも投げない", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });

    expect(() => storeCredentials({ space: "example.backlog.com", apiKey: "key" })).not.toThrow();
  });
});
