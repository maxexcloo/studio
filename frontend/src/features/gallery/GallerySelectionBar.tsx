import { useEffect, useRef, useState } from "react";
import { ActionBar, ActionIcon, Button, Menu, Text, Tooltip } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { LoaderCircle, SquareCheck, TriangleAlert } from "lucide-react";
import { icons } from "../../ui/icons";
import { failure } from "../../api";
import { layerAbove } from "../../ui/popupClicks";
import { usePhone } from "../../ui/usePhone";
import { useQueue, useQueueAction } from "../generation/Queue";
import { ActionBarGroups, ActionMenuItems, menuWidth, type Action } from "./ActionBar";
import { DeleteMediaDialog } from "./DeleteMediaDialog";
import {
  AnimateDialog,
  itemAction,
  itemActionGroups,
  useMediaActions,
  type ItemActionId,
} from "./MediaActions";
import { useMediaTransfer } from "./mediaShare";
import { UpscaleDialog } from "./UpscaleControls";
import { TrimVideoDialog } from "./videoEdits";
import { mediaDownload } from "./download";
import { finished } from "./MediaTile";
import { useFavorites } from "./useMediaFavorite";
import { useRecreateMany } from "./useRecreateMany";
import type { MediaItem } from "../../types";
import type { GallerySelection } from "./useGallerySelection";
import type { AnimateTheme } from "./useMediaAction";
import type { useTryAgain } from "./useTryAgain";
import classes from "./GallerySelectionBar.module.css";

const shareLimit = 20;
// Phones keep what acts on several items on the bar, in this order, and the rest under More.
const primaryIds = ["retry", "stop", "share", "download", "star", "delete"];

/**
 * The contextual selection bar in the toolbar's place: Clear Selection and the count, then on
 * desktop every action as an icon; phones keep the bulk actions and More on a bottom toolbar. The same actions show
 * as a context menu at `menu` (right-click or Shift+F10).
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
  const uploads = ready.filter((item) => item.uploaded);
  const recreate = useRecreateMany();
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
  // A sole selected item's own actions, kept by `OneItemActions` so the bar never remounts.
  const oneItem = useRef<Action[]>([]);
  const [, setOneItemState] = useState("");
  // Actions for one item at a time show only while one item is selected.
  const single = (id: ItemActionId) =>
    selected.length === 1 ? oneItem.current.find((action) => action.id === id) : undefined;
  const actions = itemActionGroups([
    single("animate"),
    single("edit"),
    // Several uploads share Recreate, one run queued for each.
    selected.length > 1 && uploads.length > 0
      ? itemAction("recreate", {
          disabled: recreate.isPending,
          loading: recreate.isPending,
          onClick: () => recreate.mutate(uploads),
        })
      : single("recreate"),
    single("chat"),
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
    single("compare"),
    single("upscale"),
    single("copy"),
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
  // Phones name them by what they select (All, Failed, In Progress) in the top bar.
  const quick = [
    {
      id: "select-all",
      label: "Select All",
      short: "All",
      icon: SquareCheck,
      items: selection.items,
    },
    {
      id: "select-failed",
      label: "Select Failed",
      short: "Failed",
      icon: TriangleAlert,
      items: selection.items.filter((item) => item.status === "error"),
    },
    {
      id: "select-running",
      label: "Select In Progress",
      short: "In Progress",
      icon: LoaderCircle,
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
  const primary = primaryIds.flatMap((id) => actions.flat().filter((action) => action.id === id));
  const more = actions.map((group) => group.filter((action) => !primaryIds.includes(action.id)));
  // Desktop shows every action as an icon: the selection's own, then the item actions.
  const bar = phone ? (
    <ActionBarGroups
      groups={[
        // More shows only while it has something to list.
        more.some((group) => group.length)
          ? [...primary, { id: "more", label: "More", icon: icons.more, menu: more }]
          : primary,
      ]}
      menuPosition="top-end"
    />
  ) : (
    <ActionBarGroups groups={[quick, ...actions]} menuPosition="bottom-end" />
  );
  return (
    <>
      <div className={classes.header} role="group" aria-label="Gallery Selection">
        <Text size="sm" fw={500} role="status" className={classes.count}>
          {selected.length} Selected
        </Text>
        {phone ? (
          <div
            role="group"
            aria-label="Quick Select"
            className={`${classes.actions} ${classes.quick}`}
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
                {action.short}
              </Button>
            ))}
          </div>
        ) : (
          <div role="group" aria-label="Selected Item Actions" className={classes.actions}>
            {bar}
          </div>
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
      {selected.length === 1 && (
        <OneItemActions
          item={selected[0]}
          onApplied={selection.end}
          sink={oneItem}
          onChange={setOneItemState}
        />
      )}
      <DeleteMediaDialog
        opened={confirm}
        ids={deletable.map((item) => item.id)}
        close={() => setConfirm(false)}
        onDeleted={(_deleted, failed) => selection.retain(failed)}
      />
    </>
  );
}

/** What a bar shows of the actions, so their owner re-renders only when it changes. */
const shownState = (actions: Action[]): string =>
  actions
    .map((action) =>
      [action.id, action.label, action.disabled, action.loading, action.pressed, action.checked]
        .concat(action.menu ? shownState(action.menu.flat()) : [])
        .join(","),
    )
    .join("|");

/**
 * A sole selected item's own actions, written to `sink` for the selection's bar and menu (with
 * `onChange` when what they show changes), and the dialogs they open.
 */
function OneItemActions({
  item,
  onApplied,
  sink,
  onChange,
}: {
  item: MediaItem;
  onApplied: () => void;
  sink: { current: Action[] };
  onChange: (state: string) => void;
}) {
  const transfer = useMediaTransfer(item, false);
  const [animating, setAnimating] = useState<AnimateTheme | null>(null);
  const [upscaling, setUpscaling] = useState(false);
  const [trimming, setTrimming] = useState(false);
  const actions = useMediaActions(item, {
    transfer,
    onApplied,
    onAnimate: setAnimating,
    // The selection's own Delete covers it.
    onDelete: () => {},
    onTrim: () => setTrimming(true),
    onUpscale: () => setUpscaling(true),
  }).flat();
  sink.current = actions;
  const state = `${item.id}:${shownState(actions)}`;
  useEffect(() => onChange(state), [state]);
  // Another item selected later never shows this one's actions first.
  useEffect(
    () => () => {
      sink.current = [];
    },
    [],
  );
  return (
    <>
      {animating && (
        <AnimateDialog item={item} theme={animating} onClose={() => setAnimating(null)} />
      )}
      {item.status === "done" && (
        <UpscaleDialog item={item} opened={upscaling} onClose={() => setUpscaling(false)} />
      )}
      {trimming && <TrimVideoDialog item={item} onClose={() => setTrimming(false)} />}
    </>
  );
}
