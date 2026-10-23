import { useState } from "react";
import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";

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
  function dismiss() {
    if (deletion.isPending) return;
    setFailedCount(0);
    close();
  }
  return (
    <Modal
      opened={opened}
      onClose={dismiss}
      title={ids.length === 1 ? "Delete Item" : "Delete Selected Items"}
      centered
      closeOnClickOutside={!deletion.isPending}
      closeOnEscape={!deletion.isPending}
      closeButtonProps={{ disabled: deletion.isPending }}
    >
      <Stack>
        <Text size="sm">
          Delete {ids.length} {ids.length === 1 ? "item" : "items"} from your gallery?
          Studio-managed media files will also be deleted.
        </Text>
        {!!failedCount && (
          <Alert color="red" title="Some Items Remain">
            {failedCount} {failedCount === 1 ? "item could" : "items could"} not be deleted. You can
            try again.
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" disabled={deletion.isPending} onClick={dismiss}>
            Cancel
          </Button>
          <Button
            color="red"
            loading={deletion.isPending}
            disabled={!ids.length}
            onClick={() => deletion.mutate(ids)}
          >
            Delete
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
