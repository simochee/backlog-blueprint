import { type Io } from "./io";

export const API_KEY_VARIABLE = "BACKLOG_API_KEY";

export const SPACE_VARIABLE = "BACKLOG_SPACE";

export type Credentials = { space: string; apiKey: string };

export type CredentialsError = { message: string; hint: string };

/**
 * API キーを引数から受ける道を作らない（CL-2）。`ps` で他の利用者から見え、
 * シェル履歴に残り、CI のコマンドログに出る。NFR-3 を守っても、渡し方が
 * 漏洩経路になっていては意味がない。
 */
export const resolveCredentials = (
  space: string | undefined,
  io: Io,
): Credentials | { error: CredentialsError } => {
  const domain = space ?? io.env[SPACE_VARIABLE];

  if (domain === undefined || domain === "") {
    return {
      error: {
        message: "the Backlog space domain is not set.",
        hint: `pass --space <domain> or set ${SPACE_VARIABLE}`,
      },
    };
  }

  const apiKey = io.env[API_KEY_VARIABLE];

  if (apiKey === undefined || apiKey === "") {
    return {
      error: {
        message: `${API_KEY_VARIABLE} is not set.`,
        hint: `export ${API_KEY_VARIABLE} with your Backlog API key`,
      },
    };
  }

  return { space: domain, apiKey };
};

export const isCredentialsError = (
  resolved: Credentials | { error: CredentialsError },
): resolved is { error: CredentialsError } => "error" in resolved;

export const renderCredentialsError = ({ message, hint }: CredentialsError): string =>
  `ERROR  ${message}\n  → ${hint}\n`;
