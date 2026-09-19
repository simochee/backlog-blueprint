import { useState } from "react";

export type CopyButtonProps = { label: string; text: () => string };

const FEEDBACK_MS = 2000;

export const CopyButton = ({ label, text }: CopyButtonProps) => {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(text());
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, FEEDBACK_MS);
  };

  return (
    <button className="button" onClick={() => void copy()} type="button">
      {copied ? "Copied" : label}
    </button>
  );
};
