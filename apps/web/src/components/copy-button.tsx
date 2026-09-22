import { CheckIcon, CopyIcon } from "@radix-ui/react-icons";
import { Button, IconButton, Tooltip } from "@radix-ui/themes";
import { useEffect, useState } from "react";

export type CopyButtonProps = { label: string; text: () => string; disabled?: boolean };

const FEEDBACK_MS = 2000;

const useCopy = (text: () => string): { copied: boolean; copy: () => void } => {
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
    void navigator.clipboard.writeText(text()).then(() => setCopied(true));
  };

  return { copied, copy };
};

export const CopyButton = ({ label, text, disabled = false }: CopyButtonProps) => {
  const { copied, copy } = useCopy(text);

  return (
    <Button color="gray" disabled={disabled} onClick={copy} size="3" type="button" variant="soft">
      {copied ? "Copied" : label}
    </Button>
  );
};

export const CopyIconButton = ({ label, text }: Omit<CopyButtonProps, "disabled">) => {
  const { copied, copy } = useCopy(text);

  return (
    <Tooltip content={copied ? "Copied" : label}>
      <IconButton
        aria-label={label}
        color={copied ? "green" : "gray"}
        onClick={copy}
        size="1"
        type="button"
        variant="ghost"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </IconButton>
    </Tooltip>
  );
};
