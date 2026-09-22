import { Button } from "@radix-ui/themes";
import { startTransition, useEffect, useState } from "react";

export type CopyButtonProps = { label: string; text: () => string };

const FEEDBACK_MS = 2000;

export const CopyButton = ({ label, text }: CopyButtonProps) => {
  const [copied, setCopied] = useState(false);

  /**
   * 戻すまでの時間は効果に持たせる。ハンドラの中で `setTimeout` を張ると、その 2 秒の
   * あいだに計画を取り直してこのボタンごと消えた場合に、後片付けをする場所が無い。
   */
  useEffect(() => {
    if (!copied) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setCopied(false);
    }, FEEDBACK_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  const copy = (): void => {
    startTransition(async () => {
      await navigator.clipboard.writeText(text());

      startTransition(() => {
        setCopied(true);
      });
    });
  };

  return (
    <Button color="gray" onClick={copy} size="3" type="button" variant="soft">
      {copied ? "Copied" : label}
    </Button>
  );
};
