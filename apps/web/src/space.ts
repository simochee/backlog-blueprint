const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/** 入力の途中の値にリンクを付けない。`exa` の時点で `https://exa/...` が出ても、踏んで届かない */
export const apiKeyPageUrl = (space: string): string | undefined => {
  const host = space.trim();

  return HOSTNAME.test(host) ? `https://${host}/EditApiSettings.action` : undefined;
};
