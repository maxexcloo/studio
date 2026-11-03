import { useState } from "react";
import { Alert, Button, Group, Modal, Stack, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { post } from "../../api";

interface RedditImport {
  title: string;
  imported: number;
  failed: { image: number; error: string }[];
}

/**
 * Import from Reddit: a post or gallery link's images become the account's uploads
 * (backend/gallery/reddit.js). `onImported` hears when at least one arrived.
 */
export function RedditImportDialog({
  opened,
  onClose,
  onImported,
}: {
  opened: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const client = useQueryClient();
  const [url, setUrl] = useState("");
  const importing = useMutation({
    meta: { inlineError: true },
    mutationFn: () => post<RedditImport>("/api/gallery/import/reddit", { url: url.trim() }),
    onSuccess: ({ imported, failed }) => {
      notifications.show({
        color: failed.length ? "red" : undefined,
        message: [
          `Imported ${imported} ${imported === 1 ? "image" : "images"} to Uploads.`,
          failed.length > 0 &&
            `${failed.length} couldn’t be saved: ${failed.map((entry) => entry.error).join(" ")}`,
        ]
          .filter(Boolean)
          .join(" "),
      });
      void client.invalidateQueries({ queryKey: ["gallery"] });
      void client.invalidateQueries({ queryKey: ["reference-gallery"] });
      setUrl("");
      onClose();
      onImported();
    },
  });
  return (
    <Modal
      opened={opened}
      onClose={() => {
        importing.reset();
        onClose();
      }}
      title="Import from Reddit"
      centered
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (url.trim()) importing.mutate();
        }}
      >
        <Stack>
          <TextInput
            label="Reddit Link"
            placeholder="A post or gallery link"
            type="url"
            required
            data-autofocus
            value={url}
            onChange={(event) => setUrl(event.currentTarget.value)}
          />
          {importing.error && <Alert color="red">{importing.error.message}</Alert>}
          <Group justify="flex-end">
            <Button type="submit" loading={importing.isPending} disabled={!url.trim()}>
              Import
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
