import { useCallback, useEffect, useState } from "react";

import type { MediaKind } from "../../types";
import { useRememberedKey } from "../auth/useRemembered";

function lastDeparture(key: string) {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

/** Keep the departure watermark fixed throughout the visit, including while a result is open. */
export function useGalleryDeparture(kind: MediaKind) {
  const key = useRememberedKey(`gallery-left-${kind}`);
  const [visit, setVisit] = useState(() => ({
    key,
    leftAt: lastDeparture(key),
    acknowledged: false,
  }));
  if (visit.key !== key) setVisit({ key, leftAt: lastDeparture(key), acknowledged: false });

  useEffect(() => {
    function leave() {
      try {
        localStorage.setItem(key, String(Date.now()));
      } catch {
        // Browsers can disallow local storage.
      }
    }
    function restore(event: PageTransitionEvent) {
      if (event.persisted) setVisit({ key, leftAt: lastDeparture(key), acknowledged: false });
    }
    window.addEventListener("pagehide", leave);
    window.addEventListener("pageshow", restore);
    return () => {
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("pageshow", restore);
      leave();
    };
  }, [key]);

  return {
    leftAt: visit.key === key ? visit.leftAt : 0,
    acknowledged: visit.acknowledged,
    acknowledge: useCallback(() => setVisit((current) => ({ ...current, acknowledged: true })), []),
  };
}
