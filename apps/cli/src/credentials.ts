import { type Io } from "./io";

export const API_KEY_VARIABLE = "BACKLOG_API_KEY";

export const SPACE_VARIABLE = "BACKLOG_SPACE";

export type Credentials = { space: string; apiKey: string };

/**
 * API キーを引数から受ける道を作らない（CL-2）。`ps` で他の利用者から見え、
 * シェル履歴に残り、CI のコマンドログに出る。NFR-3 を守っても、渡し方が
 * 漏洩経路になっていては意味がない。
 */
export const resolveCredentials = (
  space: string | undefined,
  io: Io,
): Credentials | { error: string } => {
  const domain = space ?? io.env[SPACE_VARIABLE];

  if (domain === undefined || domain === "") {
    return {
      error: `ERROR  the Backlog space domain is not set.\n  → pass --space <domain> or set ${SPACE_VARIABLE}\n`,
    };
  }

  const apiKey = io.env[API_KEY_VARIABLE];

  if (apiKey === undefined || apiKey === "") {
    return {
      error: `ERROR  ${API_KEY_VARIABLE} is not set.\n  → export ${API_KEY_VARIABLE} with your Backlog API key\n`,
    };
  }

  return { space: domain, apiKey };
};

export const isCredentialsError = (
  resolved: Credentials | { error: string },
): resolved is { error: string } => "error" in resolved;
