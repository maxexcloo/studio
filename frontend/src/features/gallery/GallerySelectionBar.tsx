import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActionBar, ActionIcon, Button, Group, Menu, Stack, Text, Tooltip } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, RotateCw, Share, Square, SquareX, Star, Trash2, X } from "lucide-react";
import { failure, post } from "../../api";
import { usePhone } from "../../ui/usePhone";
import { useQueue, useQueueAction } from "../generation/Queue";
import { DeleteMediaDialog } from "./DeleteMediaDialog";
import { mediaDownload } from "./download";
import { finished } from "./MediaTile";
import type { GallerySelection } from "./useGallerySelection";
import type { useTryAgain } from "./useTryAgain";

interface SelectionAction {
  id: string;
  /** The accessible name; `short` is the visible label in the action bar. */
  label: string;
  short: string;
  icon: ReactNode;
  color?: string;
  disabled?: boolean;
  loading?: boolean;
  /** A download link to `href`; other actions run `onClick`. */
  link?: boolean;
  href?: string;
  onClick?: () => void;
}

const shareLimit = 20;

/**
 * The selection header (count, quick selections, Clear and Done), the labelled bulk action bar and
 * the same actions as a context menu at `menu` for right-click or Shift+F10 on the selection.
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
  const cache = useQueryClient();
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
  const star = useMutation({
    mutationFn: async () => {
      for (let offset = 0; offset < ready.length; offset += 500)
        await post("/api/gallery/favorite", {
          ids: ready.slice(offset, offset + 500).map((item) => item.id),
          favorite: !allStarred,
        });
    },
    onSettled: () =>
      Promise.all(
        ["gallery", "gallery-filters"].map((key) => cache.invalidateQueries({ queryKey: [key] })),
      ),
  });
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
  const pending = star.isPending || busy !== null;
  const actions: SelectionAction[] = [
    {
      id: "download",
      label: "Download Selected",
      short: "Download",
      icon: <Download size={18} />,
      disabled: !ready.length || downloadTooLarge,
      link: true,
      href: ready.length && !downloadTooLarge ? downloadUrl : undefined,
    },
    ...(phone && typeof navigator.share === "function"
      ? [
          {
            id: "share",
            label: prepared ? "Share Selected" : "Prepare Share",
            short: prepared ? "Share" : "Prepare",
            icon: <Share size={18} />,
            disabled: !ready.length || ready.length > shareLimit,
            loading: prepare.isPending,
            onClick: () => void share(),
          },
        ]
      : []),
    ...(failed.length || busy === "retry"
      ? [
          {
            id: "retry",
            label: "Retry Selected",
            short: "Retry",
            icon: <RotateCw size={18} />,
            disabled: pending || !failed.length,
            loading: busy === "retry",
            onClick: () => void retrySelected(),
          },
        ]
      : []),
    ...(runningJobs.length || busy === "stop"
      ? [
          {
            id: "stop",
            label: "Stop Selected",
            short: "Stop",
            icon: <Square size={16} />,
            disabled: pending || !runningJobs.length,
            loading: busy === "stop",
            onClick: () => void stopSelected(),
          },
        ]
      : []),
    {
      id: "star",
      label: allStarred ? "Unstar Selected" : "Star Selected",
      short: allStarred ? "Unstar" : "Star",
      icon: <Star size={18} fill={allStarred ? "currentColor" : "none"} />,
      disabled: !ready.length || pending,
      loading: star.isPending,
      onClick: () => star.mutate(),
    },
    {
      id: "delete",
      label: "Delete Selected",
      short: "Delete",
      icon: <Trash2 size={18} />,
      color: "red",
      disabled: !deletable.length || pending,
      onClick: () => setConfirm(true),
    },
  ];
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
      <Group gap={4} wrap="nowrap" mih={44} aria-label="Gallery Selection" role="group">
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
                variant="subtle"
                size="compact-sm"
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
        <Group gap={4} ml="auto" wrap="nowrap">
          <Tooltip label="Clear Selection" disabled={phone}>
            <ActionIcon
              aria-label="Clear Selection"
              variant="subtle"
              color="gray"
              disabled={!selected.length || pending}
              onClick={() => selection.retain([])}
            >
              <SquareX size={18} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Done Selecting" disabled={phone}>
            <ActionIcon
              aria-label="Done Selecting"
              variant="subtle"
              color="gray"
              disabled={pending}
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
        transitionProps={{ transition: "slide-up" }}
      >
        <Stack gap={4} w="100%">
          {/* 40px keeps the desktop bar the height of the composer it replaces. */}
          <Group justify="center" gap={phone ? 0 : "xs"} wrap="nowrap" mih={phone ? undefined : 40}>
            {actions.map((action) => {
              const props = {
                "aria-label": action.label,
                variant: "subtle",
                color: action.color || "gray",
                size: phone ? "compact-xs" : "sm",
                h: phone ? 52 : undefined,
                px: phone ? 4 : undefined,
                flex: phone ? 1 : undefined,
                leftSection: phone ? undefined : action.icon,
                loading: action.loading,
                children: phone ? (
                  <Stack gap={4} align="center">
                    {action.icon}
                    {action.short}
                  </Stack>
                ) : (
                  action.short
                ),
              };
              return action.link ? (
                <Button
                  key={action.id}
                  component="a"
                  href={action.href}
                  download
                  aria-disabled={action.disabled}
                  data-disabled={action.disabled || undefined}
                  onClick={(event) => action.disabled && event.preventDefault()}
                  {...props}
                />
              ) : (
                <Button
                  key={action.id}
                  disabled={action.disabled}
                  onClick={action.onClick}
                  {...props}
                />
              );
            })}
          </Group>
          {downloadTooLarge && (
            <Text size="xs" c="dimmed" ta="center">
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
          {actions.map((action) => (
            <Menu.Item
              key={action.id}
              h={36}
              color={action.color}
              leftSection={action.icon}
              disabled={action.disabled}
              {...(action.link
                ? { component: "a" as const, href: action.href, download: true }
                : { onClick: action.onClick })}
            >
              {action.label}
            </Menu.Item>
          ))}
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
