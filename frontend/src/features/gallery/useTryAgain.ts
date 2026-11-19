import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

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
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: queueQuery.queryKey }),
        client.invalidateQueries({ queryKey: galleryKey }),
      ]),
  });

  return useCallback(
    async (jobIds: string[], selected: MediaItem[] = items) => {
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
    [items, mutateAsync],
  );
}
