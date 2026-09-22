import { type Environment } from "@backlog-blueprint/core";

/**
 * 画面が入力値を直接読まずに済むだけの事実を載せる。React Compiler は描画中に
 * 読んだモジュール変数を依存に数えないので、`hasApiKey()` のような関数呼び出しで
 * 渡すと、値が変わっても結果が使い回される。購読の返り値に載っていれば依存になる。
 */
export type SecretRevisions = {
  credentials: number;
  environment: number;
  hasApiKey: boolean;
};

/**
 * API キーを React の state に載せない（§2.4 / FR-7.4）。state に置くと値が props として
 * 画面の各所へ流れ、どこにも表示されないことを目視で確かめる仕事が残る。
 * モジュールスコープに閉じ、外に出すのは「何回書き換わったか」だけにする。
 */
let apiKey = "";

const environmentValues = new Map<string, string>();

let revisions: SecretRevisions = { credentials: 0, environment: 0, hasApiKey: false };

const listeners = new Set<() => void>();

const publish = (next: SecretRevisions): void => {
  revisions = next;

  for (const listener of listeners) {
    listener();
  }
};

export const subscribeSecrets = (listener: () => void): (() => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

export const secretRevisions = (): SecretRevisions => revisions;

export const setApiKey = (value: string): void => {
  apiKey = value;
  publish({ ...revisions, credentials: revisions.credentials + 1, hasApiKey: value !== "" });
};

export const setEnvironmentValue = (name: string, value: string): void => {
  environmentValues.set(name, value);
  publish({ ...revisions, environment: revisions.environment + 1 });
};

export const revealApiKey = (): string => apiKey;

export const environmentValue = (name: string): string => environmentValues.get(name) ?? "";

/**
 * 空欄の名前を環境に入れない。入れると core の展開（S2）が値として受け取ってしまい、
 * 「値が未入力」を判定できなくなる（検証パイプライン §4「Web UI での V-A4」）。
 */
export const enteredEnvironment = (names: string[]): Environment =>
  Object.fromEntries(
    names.flatMap((name) => {
      const value = environmentValue(name);

      return value === "" ? [] : [[name, value] as [string, string]];
    }),
  );
