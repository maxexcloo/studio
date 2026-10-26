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
  const [failedCount, setFailedCount] = useState(0);
  const deletion = useMutation({
    mutationFn: async (selected: string[]) => {
      const deleted: string[] = [],
        failed: string[] = [];
      for (const id of selected) {
        try {
          await api(`/api/gallery/${encodeURIComponent(id)}`, { method: "DELETE" });
          deleted.push(id);
        } catch {
          failed.push(id);
        }
      }
      return { deleted, failed };
    },
    onSuccess: async ({ deleted, failed }) => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["gallery"] }),
        cache.invalidateQueries({ queryKey: ["gallery-filters"] }),
        cache.invalidateQueries({ queryKey: ["session"] }),
      ]);
      setFailedCount(failed.length);
      onDeleted(deleted, failed);
      if (!failed.length) close();
    },
  });
  return (
    <ConfirmDialog
      opened={opened}
      onClose={() => {
        setFailedCount(0);
        close();
      }}
      title={ids.length === 1 ? "Delete Item" : "Delete Selected Items"}
      action="Delete"
      pending={deletion.isPending}
      disabled={!ids.length}
      onConfirm={() => deletion.mutate(ids)}
      error={
        !!failedCount &&
        `${failedCount} ${failedCount === 1 ? "item could" : "items could"} not be deleted. You can try again.`
      }
    >
      Delete {ids.length} {ids.length === 1 ? "item" : "items"} from your gallery? Studio-managed
      media files will also be deleted.
    </ConfirmDialog>
  );
}
