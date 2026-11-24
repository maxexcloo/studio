import { Button, Tooltip } from "@mantine/core";
import type { ComponentPropsWithRef } from "react";

import { icons } from "./icons";
import { usePhone } from "./usePhone";

/**
 * Select Items: starts a selection and, pressed while selecting, ends it. Named on desktop, its
 * icon alone on phones. Other props, such as a toolbar's chip look, pass to the button.
 */
export function SelectToggle({
  selecting,
  ...props
}: { selecting: boolean } & Omit<ComponentPropsWithRef<typeof Button<"button">>, "children">) {
  const phone = usePhone();
  return (
    <Tooltip label="Select Items" disabled={!phone}>
      <Button
        size="compact-sm"
        variant={selecting ? "light" : "default"}
        {...props}
        aria-label="Select Items"
        aria-pressed={selecting}
        leftSection={phone ? undefined : <icons.select size={16} />}
      >
        {phone ? <icons.select size={16} /> : "Select"}
      </Button>
    </Tooltip>
  );
}
