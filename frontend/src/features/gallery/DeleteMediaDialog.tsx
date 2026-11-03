import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { ConfirmDialog } from "../../ui/ConfirmDialog";

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
  // Why the last attempt failed: how many items, and the server's reasons.
  const [failure, setFailure] = useState<{ count: number; reasons: string[] } | null>(null);
  const deletion = useMutation({
    mutationFn: async (selected: string[]) => {
      const deleted: string[] = [],
        failed: string[] = [],
        reasons = new Set<string>();
      for (const id of selected) {
        try {
          await api(`/api/gallery/${encodeURIComponent(id)}`, { method: "DELETE" });
          deleted.push(id);
        } catch (error) {
          failed.push(id);
          if (error instanceof Error) reasons.add(error.message);
        }
      }
      return { deleted, failed, reasons: [...reasons] };
    },
    onSuccess: async ({ deleted, failed, reasons }) => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["gallery"] }),
        cache.invalidateQueries({ queryKey: ["gallery-filters"] }),
        cache.invalidateQueries({ queryKey: ["session"] }),
      ]);
      setFailure(failed.length ? { count: failed.length, reasons } : null);
      onDeleted(deleted, failed);
      if (!failed.length) close();
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
        `${failure.count} ${failure.count === 1 ? "item" : "items"} couldn’t be deleted. ${failure.reasons.join(" ") || "Try again."}`
      }
    >
      Delete {ids.length} {ids.length === 1 ? "item and its file" : "items and their files"}?
    </ConfirmDialog>
  );
}
