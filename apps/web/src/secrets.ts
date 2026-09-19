import { type Environment } from "@backlog-blueprint/core";

export type SecretRevisions = { credentials: number; environment: number };

/**
 * 秘匿値を React の state に載せない（§2.4 / FR-7.4）。state に置くと値が props として
 * 画面の各所へ流れ、どこにも表示されないことを目視で確かめる仕事が残る。
 * モジュールスコープに閉じ、外に出すのは「何回書き換わったか」だけにする。
 */
let apiKey = "";

const environmentValues = new Map<string, string>();

let revisions: SecretRevisions = { credentials: 0, environment: 0 };

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
  publish({ ...revisions, credentials: revisions.credentials + 1 });
};

export const setEnvironmentValue = (name: string, value: string): void => {
  environmentValues.set(name, value);
  publish({ ...revisions, environment: revisions.environment + 1 });
};

export const hasApiKey = (): boolean => apiKey !== "";

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
