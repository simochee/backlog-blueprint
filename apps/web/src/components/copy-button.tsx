import { useEffect, useState } from "react";

type CopyButtonProps = {
  label: string;
  text: () => string;
  disabled?: boolean;
  variant?: "primary";
  size?: "small";
  accessibleLabel?: string;
};

const FEEDBACK_MS = 1400;

const useCopy = (text: () => string): { copied: boolean; copy: () => void } => {
  const [copied, setCopied] = useState(false);

  // ハンドラの中で `setTimeout` を張らない。その間に計画を取り直してこのボタンごと
  // 消えた場合に、後片付けをする場所が無い。
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

export const CopyButton = ({
  label,
  text,
  disabled = false,
  variant,
  size,
  accessibleLabel,
}: CopyButtonProps) => {
  const { copied, copy } = useCopy(text);

  return (
    <button
      aria-label={accessibleLabel}
      className="button"
      data-copied={copied}
      data-size={size}
      data-variant={variant}
      disabled={disabled}
      onClick={copy}
      type="button"
    >
      {copied ? "Copied" : label}
    </button>
  );
};
