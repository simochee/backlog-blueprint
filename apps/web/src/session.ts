const STORAGE_KEY = "backlog-blueprint:connection";

export type StoredCredentials = { space: string; apiKey: string };

const isStoredCredentials = (value: unknown): value is StoredCredentials =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Record<string, unknown>).space === "string" &&
  typeof (value as Record<string, unknown>).apiKey === "string";

/**
 * 読み書きの失敗を投げない。`sessionStorage` はプライベートブラウズや設定で使えない
 * ことがあり、そこで落ちると接続そのものができなくなる。保てないなら、リロードの
 * たびに打ち直すだけで済ませる（WU-38）。
 */
const storage = (): Storage | undefined => {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
};

export const readStoredCredentials = (): StoredCredentials | undefined => {
  try {
    const parsed: unknown = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? "null");

    return isStoredCredentials(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

export const storeCredentials = (credentials: StoredCredentials): void => {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(credentials));
  } catch {
    /* 保てなくても接続は続ける（上の Why-not） */
  }
};

export const forgetCredentials = (): void => {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    /* 同上 */
  }
};
