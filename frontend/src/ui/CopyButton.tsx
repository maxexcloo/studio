import { Button, type ButtonProps } from "@mantine/core";
import { Check } from "lucide-react";

import { useCopy } from "./clipboard";
import { icons } from "./icons";

/** A button that copies `text` and reads Copied for a moment; nothing to copy disables it. */
export function CopyButton({
  text,
  label = "Copy",
  disabled,
  ...props
}: ButtonProps & { text: string; label?: string }) {
  const { copied, copy } = useCopy();
  return (
    <Button
      variant="default"
      leftSection={copied ? <Check size={16} /> : <icons.copy size={16} />}
      disabled={disabled || !text}
      onClick={() => copy(text)}
      {...props}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}
