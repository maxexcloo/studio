import { useEffect, useState } from "react";

/**
 * For a dialog that mounts open and unmounts to close: Mantine returns focus only when `opened`
 * changes, so this returns it to what had it as the dialog appeared, unless focus has moved on.
 */
export function useReturnFocus() {
  const [from] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(
    () => () => {
      setTimeout(() => {
        if (!document.activeElement || document.activeElement === document.body)
          from?.focus({ preventScroll: true });
      });
    },
    [from],
  );
}
