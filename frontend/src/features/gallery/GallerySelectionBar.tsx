import { useEffect, useRef, useState } from "react";
import { ActionBar, Button, Group, Menu, Stack, Text } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react";
import { failure } from "../../api";
import { usePhone } from "../../ui/usePhone";
import { chipProps } from "../generation/chip";
import { useQueue, useQueueAction } from "../generation/Queue";
import { ActionBarGroups, ActionMenuItems, actionBarClass } from "./ActionBar";
import { DeleteMediaDialog } from "./DeleteMediaDialog";
import { itemAction, itemActionGroups } from "./MediaActions";
import { mediaDownload } from "./download";
import { finished } from "./MediaTile";
import { useFavorites } from "./useMediaFavorite";
import type { GallerySelection } from "./useGallerySelection";
import type { useTryAgain } from "./useTryAgain";

const shareLimit = 20;

/**
 * The selection header (count and quick selections), the bulk action bar in the viewer's sections
 * (labelled on desktop) with Close, and the same actions as a context menu at `menu` (right-click
 * or Shift+F10).
 */
export function GallerySelectionBar({
  selection,
  tryAgain,
  menu,
  onMenuClose,
}: {
  selection: GallerySelection;
  tryAgain: ReturnType<typeof useTryAgain>;
  menu: { x: number; y: number } | null;
  onMenuClose: () => void;
}) {
  const phone = usePhone();
  const [confirm, setConfirm] = useState(false);
  const queue = useQueue();
  const cancel = useQueueAction();
  const [busy, setBusy] = useState<"retry" | "stop" | null>(null);
  const latestSelection = useRef(selection);
  latestSelection.current = selection;
  const selected = selection.selectedItems;
  const ready = selected.filter((item) => item.status === "done" && item.url);
  const running = selected.filter((item) => !finished(item));
  const deletable = selected.filter(finished);
  const failedIds = new Set(
    selected.filter((item) => item.status === "error").map((item) => item.jobId),
  );
  const failed = (queue.data?.jobs || []).filter(
    (job) => job.status === "failed" && failedIds.has(job.id),
  );
  const runningJobs = [...new Set(running.map((item) => item.jobId).filter(Boolean))] as string[];
  const allStarred = ready.length > 0 && ready.every((item) => item.favorite);
  const downloadUrl = `/api/gallery/export?${new URLSearchParams({ ids: ready.map((item) => item.id).join(",") })}`;
  const downloadTooLarge = ready.length > 1000 || downloadUrl.length > 6000;
  const favorites = useFavorites();
  // Native sharing needs the tap itself, so the files are prepared first, as for one result.
  const shareKey = ready.map((item) => item.id).join("\n");
  const [shareFiles, setShareFiles] = useState<{ key: string; files: File[] } | null>(null);
  const prepared = shareFiles?.key === shareKey ? shareFiles.files : null;
  const prepare = useMutation({
    mutationFn: () =>
      Promise.all(
        ready.map(async (item) => {
          const target = mediaDownload(item);
          const response = await fetch(target.href, { credentials: "same-origin" });
          if (!response.ok) throw new Error(`Studio could not prepare ${target.download}.`);
          const blob = await response.blob();
          return new File([blob], target.download, { type: blob.type });
        }),
      ),
    onSuccess: (files) => setShareFiles({ key: shareKey, files }),
  });
  async function share() {
    if (!prepared) return prepare.mutate();
    try {
      await navigator.share({ files: prepared });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) failure(error);
    }
  }
  async function retrySelected() {
    setBusy("retry");
    try {
      const accepted = await tryAgain(failed.map((job) => job.id));
      const current = latestSelection.current;
      current.retain(
        current.selectedItems
          .filter((item) => !accepted.has(item.jobId || ""))
          .map((item) => item.id),
      );
    } finally {
      setBusy(null);
    }
  }
  async function stopSelected() {
    setBusy("stop");
    try {
      await Promise.allSettled(
        runningJobs.map((id) => cancel.mutateAsync({ id, action: "cancel" })),
      );
    } finally {
      setBusy(null);
    }
  }
  const pending = busy !== null;
  // Actions for one item at a time stay in place, greyed out, so the bar matches the viewer's.
  const single = { disabled: true };
  const actions = itemActionGroups([
    itemAction("animate", single),
    itemAction("edit", single),
    itemAction("recreate", single),
    itemAction("reference", single),
    (failed.length > 0 || busy === "retry") &&
      itemAction("retry", {
        disabled: pending || !failed.length,
        loading: busy === "retry",
        onClick: () => void retrySelected(),
      }),
    (runningJobs.length > 0 || busy === "stop") &&
      itemAction("stop", {
        disabled: pending || !runningJobs.length,
        loading: busy === "stop",
        onClick: () => void stopSelected(),
      }),
    itemAction("compare", single),
    itemAction("upscale", single),
    itemAction("copy", single),
    // Phones that share natively share instead of downloading.
    phone && typeof navigator.share === "function"
      ? itemAction("share", {
          label: prepared ? "Share" : "Prepare Share",
          disabled: !ready.length || ready.length > shareLimit,
          loading: prepare.isPending,
          onClick: () => void share(),
        })
      : itemAction("download", {
          disabled: !ready.length || downloadTooLarge,
          link: {
            href: ready.length && !downloadTooLarge ? downloadUrl : undefined,
            download: true,
          },
        }),
    itemAction("delete", {
      disabled: !deletable.length || pending,
      onClick: () => setConfirm(true),
    }),
    itemAction("star", {
      label: allStarred ? "Unstar" : "Star",
      pressed: allStarred,
      disabled: !ready.length || pending,
      onClick: () => favorites.mutate({ ids: ready.map((item) => item.id), favorite: !allStarred }),
    }),
  ]);
  useEffect(() => {
    if (confirm || pending) return;
    const keys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        event.defaultPrevented ||
        document.querySelector('[role="dialog"]') ||
        // Typing, and Escape closing a menu or popover, belong to those controls.
        target.closest(
          "input, textarea, [contenteditable], [role='menu'], .mantine-Popover-dropdown",
        )
      )
        return;
      if (event.key === "Escape") selection.end();
      else if ((event.key === "Delete" || event.key === "Backspace") && deletable.length) {
        event.preventDefault();
        setConfirm(true);
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [confirm, pending, selection.end, deletable.length]);
  const quick = [
    { label: "All", name: "Select All Loaded", items: selection.items },
    {
      label: "Failed",
      name: "Select Failed",
      items: selection.items.filter((item) => item.status === "error"),
    },
    {
      label: "In Progress",
      name: "Select In Progress",
      items: selection.items.filter((item) => !finished(item)),
    },
  ];
  return (
    <>
      <Group gap={6} wrap="nowrap" mih={44} aria-label="Gallery Selection" role="group">
        <Text
          size="sm"
          fw={500}
          role="status"
          mr={4}
          style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}
        >
          {selected.length} Selected
        </Text>
        {quick.map(
          ({ label, name, items }, index) =>
            (index === 0 || items.length > 0) && (
              <Button
                key={name}
                {...chipProps}
                aria-label={name}
                disabled={!items.length || pending}
                onClick={() => {
                  const ids = new Set(items.map((item) => item.id));
                  selection.select((item) => ids.has(item.id));
                }}
              >
                {label}
              </Button>
            ),
        )}
        <Button
          {...chipProps}
          aria-label="Clear Selection"
          disabled={!selected.length || pending}
          onClick={() => selection.retain([])}
        >
          Clear
        </Button>
      </Group>
      <ActionBar
        opened={selection.selecting}
        aria-label="Selected Item Actions"
        radius="xl"
        shadow="lg"
        className={actionBarClass}
        position={{
          left: 0,
          right: 0,
          bottom: "calc(var(--studio-composer-gap) + env(safe-area-inset-bottom))",
        }}
        transitionProps={{ transition: "slide-up" }}
      >
        <Stack gap={4} align="center" miw={0}>
          <Group gap={2} wrap="nowrap" maw="100%">
            <ActionBarGroups
              groups={actions}
              labelled={!phone}
              trailing={
                <Button
                  variant="subtle"
                  color="gray"
                  size="compact-sm"
                  leftSection={<X size={16} />}
                  aria-label="Close Selection"
                  disabled={pending}
                  onClick={selection.end}
                >
                  Close
                </Button>
              }
            />
          </Group>
          {downloadTooLarge && (
            <Text size="xs" c="dimmed" ta="center" px="sm">
              Select fewer items to download in one archive.
            </Text>
          )}
        </Stack>
      </ActionBar>
      <Menu opened={menu !== null} onChange={(opened) => !opened && onMenuClose()} width={220}>
        <Menu.Target>
          <div
            aria-hidden
            style={{ position: "fixed", left: menu?.x, top: menu?.y, width: 0, height: 0 }}
          />
        </Menu.Target>
        <Menu.Dropdown aria-label="Selection Actions">
          <Menu.Label>{selected.length} Selected</Menu.Label>
          <ActionMenuItems groups={actions} />
        </Menu.Dropdown>
      </Menu>
      <DeleteMediaDialog
        opened={confirm}
        ids={deletable.map((item) => item.id)}
        close={() => setConfirm(false)}
        onDeleted={(_deleted, failed) => selection.retain(failed)}
      />
    </>
  );
}
