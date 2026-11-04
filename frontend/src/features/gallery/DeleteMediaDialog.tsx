import { useState } from "react";
import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { post } from "../../api";
import type { MediaItem } from "../../types";
import { ConfirmDialog } from "../../ui/ConfirmDialog";

type Pages = InfiniteData<{ items: MediaItem[] }>;

export function DeleteMediaDialog({
  opened,
  ids,
  close,
  onDeleted,
}: {
  opened: boolean;
  ids: string[];
  close: () => void;
  onDeleted: (deleted: string[], failed: string[]) => void;
}) {
  const cache = useQueryClient();
  // Why the last attempt failed: how many items, and the server's reason.
  const [failure, setFailure] = useState<{ count: number; reason: string } | null>(null);
  // One request for every item, so a large selection costs one store change and one refresh.
  const deletion = useMutation({
    meta: { inlineError: true },
    mutationFn: (selected: string[]) =>
      post<{ removed: string[] }>("/api/gallery/delete", { ids: selected }),
    onSuccess: ({ removed }, selected) => {
      const gone = new Set(removed);
      // The gallery drops them at once; the refresh below brings counts and neighbours up to date.
      cache.setQueriesData<Pages>({ queryKey: ["gallery"] }, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                items: page.items.filter((item) => !gone.has(item.id)),
              })),
            }
          : data,
      );
      const failed = selected.filter((id) => !gone.has(id));
      setFailure(failed.length ? { count: failed.length, reason: "" } : null);
      onDeleted(removed, failed);
      if (!failed.length) close();
    },
    onError: (error, selected) => {
      setFailure({ count: selected.length, reason: error.message });
      onDeleted([], selected);
    },
    onSettled: () => {
      for (const key of ["gallery", "gallery-filters", "session"])
        void cache.invalidateQueries({ queryKey: [key] });
    },
  });
  return (
    <ConfirmDialog
      opened={opened}
      onClose={() => {
        setFailure(null);
        close();
      }}
      title={ids.length === 1 ? "Delete Item" : "Delete Selected Items"}
      action="Delete"
      pending={deletion.isPending}
      disabled={!ids.length}
      onConfirm={() => deletion.mutate(ids)}
      error={
        failure &&
        `${failure.count} ${failure.count === 1 ? "item" : "items"} couldn’t be deleted. ${failure.reason || "Try again."}`
      }
    >
      Delete {ids.length} {ids.length === 1 ? "item and its file" : "items and their files"}?
    </ConfirmDialog>
  );
}
