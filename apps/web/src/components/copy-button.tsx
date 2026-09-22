import { Button } from "@radix-ui/themes";
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
    <Button color="gray" onClick={() => void copy()} size="3" type="button" variant="soft">
      {copied ? "Copied" : label}
    </Button>
  );
};
