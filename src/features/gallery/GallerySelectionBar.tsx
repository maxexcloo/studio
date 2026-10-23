import { useEffect, useState } from "react";
import {
  ActionBar,
  ActionIcon,
  Alert,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { useMotionDuration } from "../../ui/Appearance";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, SquareX, Star, Trash2, X } from "lucide-react";
import { api, failure, post } from "../../api";
import type { GallerySelection } from "./useGallerySelection";

export function GallerySelectionBar({ selection }: { selection: GallerySelection }) {
  const motionDuration = useMotionDuration();
  const [confirm, setConfirm] = useState(false);
  const [deleteFailures, setDeleteFailures] = useState("");
  const cache = useQueryClient();
  const selected = selection.selectedItems;
  const ready = selected.filter((item) => item.status === "done" && item.url);
  const allStarred = ready.length > 0 && ready.every((item) => item.favorite);
  const downloadUrl = `/api/gallery/export?${new URLSearchParams({ ids: ready.map((item) => item.id).join(",") })}`;
  const downloadTooLarge = ready.length > 1000 || downloadUrl.length > 6000;
  const mutation = useMutation({
    mutationFn: async (action: "star" | "delete") => {
      if (action === "star") {
        for (let offset = 0; offset < ready.length; offset += 500)
          await post("/api/gallery/favorite", {
            ids: ready.slice(offset, offset + 500).map((item) => item.id),
            favorite: !allStarred,
          });
        return;
      }
      const failed: string[] = [];
      for (const item of selected) {
        try {
          await api(`/api/gallery/${encodeURIComponent(item.id)}`, { method: "DELETE" });
        } catch {
          failed.push(item.id);
        }
      }
      selection.retain(failed);
      setDeleteFailures(
        failed.length
          ? `${failed.length} ${failed.length === 1 ? "item could" : "items could"} not be deleted. They remain selected so you can try again.`
          : "",
      );
      setConfirm(false);
    },
    onError: failure,
    onSettled: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["gallery"] }),
        cache.invalidateQueries({ queryKey: ["gallery-filters"] }),
      ]);
    },
  });
  useEffect(() => {
    if (confirm || mutation.isPending) return;
    const close = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !document.querySelector('[role="dialog"]')
      )
        selection.end();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [confirm, mutation.isPending, selection.end]);
  return (
    <>
      <Group gap={4} wrap="nowrap" mih={44} aria-label="Gallery Selection" role="group">
        <Text size="sm" c="dimmed" role="status" style={{ whiteSpace: "nowrap" }}>
          {selected.length} Selected
        </Text>
        <Button
          variant="subtle"
          size="compact-sm"
          aria-label="Select All Loaded"
          disabled={!selection.selectable.length || mutation.isPending}
          onClick={selection.selectAll}
        >
          All Loaded
        </Button>
        <Group gap={4} ml="auto" wrap="nowrap">
          <Tooltip label="Clear Selection">
            <ActionIcon
              aria-label="Clear Selection"
              variant="subtle"
              color="gray"
              size={36}
              disabled={!selected.length || mutation.isPending}
              onClick={() => selection.retain([])}
            >
              <SquareX size={18} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Done Selecting">
            <ActionIcon
              aria-label="Done Selecting"
              variant="subtle"
              color="gray"
              size={36}
              disabled={mutation.isPending}
              onClick={selection.end}
            >
              <X size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      <ActionBar
        opened={selection.selecting}
        aria-label="Selected Item Actions"
        radius="xl"
        position={{
          left: 0,
          right: 0,
          bottom: "calc(var(--studio-composer-gap) + env(safe-area-inset-bottom))",
        }}
        w="calc(100% - 2 * var(--studio-composer-gap))"
        maw="var(--studio-composer-width)"
        transitionProps={{ transition: "slide-up", duration: motionDuration }}
      >
        <Stack gap="xs" w="100%">
          <Group justify="center" gap="sm">
            <Tooltip label="Download Selected as a Zip">
              <ActionIcon
                component="a"
                href={ready.length && !downloadTooLarge ? downloadUrl : undefined}
                download
                aria-label="Download Selected"
                aria-disabled={!ready.length || downloadTooLarge}
                variant="subtle"
                color="gray"
                size={44}
                onClick={(event) => {
                  if (!ready.length || downloadTooLarge) event.preventDefault();
                }}
              >
                <Download size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={allStarred ? "Unstar Selected" : "Star Selected"}>
              <ActionIcon
                aria-label={allStarred ? "Unstar Selected" : "Star Selected"}
                variant="subtle"
                color="gray"
                size={44}
                disabled={!ready.length || mutation.isPending}
                onClick={() => mutation.mutate("star")}
              >
                <Star size={18} fill={allStarred ? "currentColor" : "none"} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Delete Selected">
              <ActionIcon
                aria-label="Delete Selected"
                variant="subtle"
                color="red"
                size={44}
                disabled={!selected.length || mutation.isPending}
                onClick={() => setConfirm(true)}
              >
                <Trash2 size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
          {downloadTooLarge && (
            <Text size="xs" c="dimmed" ta="center">
              Select fewer items to download in one archive.
            </Text>
          )}
          {deleteFailures && (
            <Alert color="red" title="Some Items Remain">
              {deleteFailures}
            </Alert>
          )}
        </Stack>
      </ActionBar>
      <Modal
        opened={confirm}
        onClose={() => {
          if (!mutation.isPending) setConfirm(false);
        }}
        title="Delete Selected Items"
        centered
        closeOnClickOutside={!mutation.isPending}
        closeOnEscape={!mutation.isPending}
      >
        <Stack>
          <Text size="sm">
            Delete {selected.length} selected {selected.length === 1 ? "item" : "items"} from your
            gallery? Studio-managed media files will also be deleted.
          </Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              disabled={mutation.isPending}
              onClick={() => setConfirm(false)}
            >
              Cancel
            </Button>
            <Button
              color="red"
              loading={mutation.isPending}
              onClick={() => mutation.mutate("delete")}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
