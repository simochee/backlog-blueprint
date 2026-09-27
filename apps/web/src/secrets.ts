/**
 * `hasApiKey()` のような関数で渡さない。React Compiler は描画中に読んだモジュール変数を
 * 依存に数えないので、値が変わっても結果が使い回される。購読の返り値に載せれば依存になる。
 */
type SecretRevisions = {
  credentials: number;
  environment: number;
  hasApiKey: boolean;
};

/**
 * API キーを React の state に載せない（§2.4 / FR-7.4）。値が props として画面の各所へ流れ、
 * どこにも表示されないことを目視で確かめる仕事が残る。
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
