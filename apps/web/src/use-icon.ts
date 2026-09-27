import { useEffect, useState } from "react";

import { transport } from "./transport";

type Icon = { key: string; url: string };

/**
 * `<img src>` に Backlog の URL を渡さない。取得に API キーが要り、URL に載せると
 * DOM の属性にキーが出る（WU-35）。
 *
 * path だけを `key` にしない。別のスペースに繋ぎ直しても `/api/v2/space/image` のまま
 * 変わらず、前のスペースのアイコンが残る。
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
      // 失敗を投げ直さない。アイコンは飾りで、取れなければ頭文字で描けば済む。
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
