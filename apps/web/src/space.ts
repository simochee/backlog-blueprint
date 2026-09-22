const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * 入力の途中の値にもリンクを付ける案は採らない。`exa` の時点で
 * `https://exa/EditApiSettings.action` へのリンクが出ると、踏んでも届かない。
 * ホスト名として成立している形だけを通すので、スキームや path を書かれた場合も
 * ここで落ちる。
 */
export const apiKeyPageUrl = (space: string): string | undefined => {
  const host = space.trim();

  return HOSTNAME.test(host) ? `https://${host}/EditApiSettings.action` : undefined;
};
