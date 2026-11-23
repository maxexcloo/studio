import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";

import type { QueueRetryResponse } from "../../../../shared/queue";
import { failure, post } from "../../api";
import type { MediaItem } from "../../types";
import { queueActionKey, queueQuery } from "../generation/Queue";
import { mediaTitle } from "./mediaLabels";
import { galleryKey } from "./queries";

export function useTryAgain(items: MediaItem[]) {
  const client = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationKey: queueActionKey,
    mutationFn: (body: { ids: string[] }) => post<QueueRetryResponse>("/api/queue/retry", body),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queueQuery.queryKey });
      void client.invalidateQueries({ queryKey: galleryKey });
    },
  });

  // Reads the latest items, so tiles keep one Retry handler as pages arrive.
  const latest = useRef(items);
  latest.current = items;
  return useCallback(
    async (jobIds: string[], selected: MediaItem[] = latest.current) => {
      const ids = [...new Set(jobIds)];
      const accepted = new Map<string, string>();
      if (!ids.length) return accepted;
      try {
        const { outcomes } = await mutateAsync({ ids });
        for (const outcome of outcomes)
          if ("replacement" in outcome) accepted.set(outcome.id, outcome.replacement);
        const refused = outcomes.find((outcome) => "error" in outcome);
        if (refused) {
          const item = selected.find((item) => item.jobId === refused.id);
          failure(item ? `${mediaTitle(item)}. ${refused.error}` : refused.error);
        }
      } catch {
        // The MutationCache reports a failed request.
      }
      return accepted;
    },
    [mutateAsync],
  );
}
