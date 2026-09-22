import { useEffect, useState } from "react";

import { transport } from "./transport";

type Icon = { key: string; url: string };

/**
 * `<img src>` に Backlog の URL を渡さない（WU-35）。取得に API キーが要り、URL に載せると
 * DOM の属性にキーが出る。送信層で取って `blob:` の URL にする。
 *
 * `key` は接続の印と path を合わせたもの。path だけだと、別のスペースに繋ぎ直しても
 * `/api/v2/space/image` のまま変わらず、前のスペースのアイコンが残る。
 */
export const useIcon = (key: string, path: string | undefined): string | undefined => {
  const [icon, setIcon] = useState<Icon>();

  useEffect(() => {
    if (path === undefined) {
      return undefined;
    }

    let url: string | undefined;
    let cancelled = false;

    transport.getBytes(path).then(
      (bytes) => {
        if (cancelled) {
          return;
        }

        url = URL.createObjectURL(new Blob([bytes]));
        setIcon({ key, url });
      },
      /** 取れなければ頭文字で描く。アイコンは飾りで、接続の成否とは関係しない */
      () => undefined,
    );

    return () => {
      cancelled = true;

      if (url !== undefined) {
        URL.revokeObjectURL(url);
      }
    };
  }, [key, path]);

  return icon?.key === key ? icon.url : undefined;
};
