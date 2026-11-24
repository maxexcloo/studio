import { useEffect } from "react";

import { failure } from "../api";

/** Shows a failed background load once as the compact timed banner, leaving the view in place. */
export function useFailureBanner(error: Error | null | undefined) {
  useEffect(() => {
    if (error) failure(error);
  }, [error]);
}
