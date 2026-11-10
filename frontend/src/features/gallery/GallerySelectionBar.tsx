import { useEffect, useRef, useState } from "react";
import { ActionBar, ActionIcon, Button, Divider, Menu, Text, Tooltip } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Shuffle } from "lucide-react";
import { icons } from "../../ui/icons";
import { failure, post } from "../../api";
import { layerAbove } from "../../ui/popupClicks";
import { usePhone } from "../../ui/usePhone";
import { useQueue, useQueueAction } from "../generation/Queue";
import { ActionBarGroups, ActionMenuItems, withMore } from "./ActionBar";
import { menuWidth } from "../../theme";
import { DeleteMediaDialog } from "./DeleteMediaDialog";
import { itemAction, itemActionGroups } from "./itemActions";
import { mediaDownload } from "./download";
import { finished } from "./MediaTile";
import { useFavorites } from "./useMediaFavorite";
import { useRecreateMany } from "./useRecreateMany";
import type { GallerySelection } from "./useGallerySelection";
import type { useTryAgain } from "./useTryAgain";
import classes from "./GallerySelectionBar.module.css";

const shareLimit = 20;
// Compare Selected sets out up to four images side by side, one per number key.
const compareLimit = 4;
// Phones keep what acts on several items on the bar and the rest under More.
const primaryIds = ["retry", "stop", "share", "download", "star", "delete"];

/**
 * The contextual selection bar in the toolbar's place: the count and the quick selects, then on
 * desktop the selection's actions as icons and Clear Selection; phones keep the actions and More
 * on a bottom toolbar. The same actions show as a context menu at `menu` (right-click or
 * Shift+F10).
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
    selected.filter((item) => item.status === "failed").map((item) => item.jobId),
  );
  const failed = (queue.data?.jobs || []).filter(
    (job) => job.status === "failed" && failedIds.has(job.id),
  );
  const runningJobs = [...new Set(running.map((item) => item.jobId).filter(Boolean))] as string[];
  const allStarred = ready.length > 0 && ready.every((item) => item.favorite);
  const downloadUrl = `/api/gallery/export?${new URLSearchParams({ ids: ready.map((item) => item.id).join(",") })}`;
  const downloadTooLarge = ready.length > 1000 || downloadUrl.length > 6000;
  const favorites = useFavorites();
  const uploads = ready.filter((item) => item.uploaded);
  const recreate = useRecreateMany();
  // Compare shows for 2–4 finished images and takes them when each is from its own run, since a
  // comparison votes per run.
  const navigate = useNavigate();
  const images =
    selected.length >= 2 &&
    selected.length <= compareLimit &&
    selected.every((item) => item.type === "image" && item.status === "done");
  const comparable =
    images &&
    selected.every((item) => item.jobId) &&
    new Set(selected.map((item) => item.jobId)).size === selected.length;
  const compare = useMutation({
    mutationFn: () =>
      post<{ id: string }>("/api/comparisons", {
        jobIds: selected.map((item) => item.jobId),
        itemIds: selected.map((item) => item.id),
      }),
    onSuccess: (comparison) => {
      selection.end();
      navigate(`/compare/${comparison.id}`);
    },
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
  const pending = busy !== null;
  // Only what acts on the selection as a whole; an item's own actions stay on its tile and viewer.
  const actions = itemActionGroups([
    // Selected uploads share Edit › Run Suggested Prompts, one run queued for each.
    uploads.length > 0 &&
      itemAction("edit", {
        loading: recreate.isPending,
        menu: [
          [
            {
              id: "run-suggested",
              label: "Run Suggested Prompts",
              description: "Queue each upload's suggested prompt",
              icon: Shuffle,
              disabled: recreate.isPending,
              onClick: () => recreate.mutate(uploads),
            },
          ],
        ],
      }),
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
    images &&
      itemAction("compare", {
        disabled: !comparable || compare.isPending || pending,
        loading: compare.isPending,
        onClick: () => compare.mutate(),
      }),
    // Phones that share natively share instead of downloading.
    phone && typeof navigator.share === "function"
      ? itemAction("share", {
          label: "Share",
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
    itemAction("star", {
      label: allStarred ? "Unstar" : "Star",
      pressed: allStarred,
      disabled: !ready.length || pending,
      onClick: () => favorites.mutate({ ids: ready.map((item) => item.id), favorite: !allStarred }),
    }),
    itemAction("delete", {
      disabled: !deletable.length || pending,
      onClick: () => setConfirm(true),
    }),
  ]);
  useEffect(() => {
    if (confirm || pending) return;
    const keys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      // Typing belongs to the field, and Escape to a layer stacked over the gallery.
      if (
        event.defaultPrevented ||
        layerAbove(null, event) ||
        target.closest("input, textarea, [contenteditable]")
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
  // Phones name them by what they select (All, Failed, In Progress).
  const quick = [
    { id: "select-all", label: "Select All", short: "All", items: selection.items },
    {
      id: "select-failed",
      label: "Select Failed",
      short: "Failed",
      items: selection.items.filter((item) => item.status === "failed"),
    },
    {
      id: "select-running",
      label: "Select In Progress",
      short: "In Progress",
      items: selection.items.filter((item) => !finished(item)),
    },
  ]
    .filter(({ id, items }) => id === "select-all" || items.length > 0)
    .map(({ items, ...action }) => ({
      ...action,
      disabled: !items.length || pending,
      onClick: () => {
        const ids = new Set(items.map((item) => item.id));
        selection.select((item) => ids.has(item.id));
      },
    }));
  const bar = phone ? (
    <ActionBarGroups groups={[withMore(actions, primaryIds).flat()]} menuPosition="top-end" />
  ) : (
    <ActionBarGroups groups={actions} menuPosition="bottom-end" />
  );
  return (
    <>
      <div className={classes.header} role="group" aria-label="Gallery Selection">
        <Text size="sm" fw={500} role="status" className={classes.count}>
          {selected.length} Selected
        </Text>
        {!phone && <Divider orientation="vertical" className={classes.divider} />}
        <div
          role="group"
          aria-label="Quick Select"
          className={phone ? `${classes.actions} ${classes.quick}` : classes.quick}
        >
          {quick.map((action) => (
            <Button
              key={action.id}
              size="compact-sm"
              variant="subtle"
              color="gray"
              aria-label={action.label}
              disabled={action.disabled}
              onClick={action.onClick}
            >
              {phone ? action.short : action.label}
            </Button>
          ))}
        </div>
        {!phone && (
          <>
            <div role="group" aria-label="Selected Item Actions" className={classes.actions}>
              {bar}
            </div>
            <Divider orientation="vertical" className={classes.divider} />
          </>
        )}
        {/* The count leads; closing the selection is always the last icon. */}
        <Tooltip label="Clear Selection">
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label="Clear Selection"
            disabled={pending}
            onClick={selection.end}
          >
            <icons.clear size={18} />
          </ActionIcon>
        </Tooltip>
      </div>
      {phone && (
        <ActionBar
          opened
          aria-label="Selected Item Actions"
          radius={0}
          shadow="none"
          className={classes.toolbar}
          position={{ left: 0, right: 0, bottom: 0 }}
          transitionProps={{ transition: "slide-up" }}
        >
          {bar}
        </ActionBar>
      )}
      <Menu
        opened={menu !== null}
        onChange={(opened) => !opened && onMenuClose()}
        width={menuWidth}
      >
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
