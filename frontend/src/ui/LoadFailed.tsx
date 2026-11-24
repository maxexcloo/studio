import type { ReactNode } from "react";

import { EmptyState } from "./EmptyState";
import { useFailureBanner } from "./useFailureBanner";

/** A view that could not load: the timed banner says why, the view says what is missing. */
export function LoadFailed({ error, children }: { error: Error; children: ReactNode }) {
  useFailureBanner(error);
  return <EmptyState fill>{children}</EmptyState>;
}
