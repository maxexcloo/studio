import { ActionIcon, Button, Divider, Menu, Text, Tooltip } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Shuffle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { failure, post } from "../../api";
import { menuWidth } from "../../theme";
import type { MediaItem } from "../../types";
import { ActionBarGroups, ActionMenuItems } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";
import { layerAbove } from "../../ui/popupClicks";
import { usePhone } from "../../ui/usePhone";
import { assistMenu } from "../generation/AskChange";
import { useQueue, useQueueAction } from "../generation/Queue";
import { DeleteMediaDialog } from "./DeleteMediaDialog";
import { mediaDownload } from "./download";
import { itemAction, itemActionGroups, namedItemActions } from "./itemActions";
import { prepareMediaShare } from "./mediaShare";
import { finished } from "./MediaTile";
import { useUpscaleMany } from "./UpscaleControls";
import type { GallerySelection } from "./useGallerySelection";
import { useAnimateTemplates, useIterate } from "./useMediaAction";
import { showDisliked, useRatings } from "./useMediaRating";
import { useRecreateMany } from "./useRecreateMany";
import type { useTryAgain } from "./useTryAgain";

import classes from "./GallerySelectionBar.module.css";

const shareLimit = 20;
// Compare Selected sets out up to four images side by side, one per number key.
const compareLimit = 4;

/**
 * The contextual selection bar under the toolbar: the count and quick selects, then
 * the selection's actions and Clear Selection. The same actions show as a context menu at `menu`
 * (right-click or Shift+F10).
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
  /**
   * A finished action leaves selection mode; the items it failed for stay selected, with its error
   * shown by the action itself.
   */
  const settle = (failedIds: string[] = []) =>
    failedIds.length ? latestSelection.current.retain(failedIds) : latestSelection.current.end();
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
  const allRated = (rating: string) =>
    ready.length > 0 && ready.every((item) => item.rating === rating);
  const allLiked = allRated("liked");
  const allDisliked = allRated("disliked");
  // The selection is posted, being too long for a URL, and downloads from the link it returns.
  const download = useMutation({
    mutationFn: () =>
      post<{ href: string }>("/api/gallery/export", { ids: ready.map((item) => item.id) }),
    onSuccess: ({ href }) => {
      const link = Object.assign(document.createElement("a"), { href, download: "" });
      link.click();
      settle();
    },
  });
  const ratings = useRatings();
  const uploads = ready.filter((item) => item.uploaded);
  const recreate = useRecreateMany();
  // A set or run is animated or upscaled as a whole (Runs' Select Set).
  const finishedImages = ready.filter((item) => item.type === "image" && !item.uploaded);
  const upscale = useUpscaleMany(finishedImages);
  const iterate = useIterate();
  const templates = useAnimateTemplates();
  const client = useQueryClient();
  const animate = useMutation({
    mutationFn: async (theme: string) => {
      const failed: string[] = [];
      let error: unknown;
      for (const item of finishedImages)
        await iterate(item, { kind: "animate", theme }).catch((reason: unknown) => {
          failed.push(item.id);
          error ??= reason;
        });
      if (error) failure(error);
      settle(failed);
    },
  });
  // Compare takes 2–4 finished images, including different outputs of the same batch.
  const navigate = useNavigate();
  const images =
    selected.length >= 2 &&
    selected.length <= compareLimit &&
    selected.every((item) => item.type === "image" && item.status === "done");
  const comparable = images && selected.every((item) => item.jobId);
  const compare = useMutation({
    mutationFn: () =>
      post<{ id: string }>("/api/comparisons", {
        jobIds: selected.map((item) => item.jobId),
        itemIds: selected.map((item) => item.id),
      }),
    onSuccess: (comparison) => {
      selection.end();
      void client.invalidateQueries({ queryKey: ["comparisons"] });
      navigate(`/compare/${comparison.id}`);
    },
  });
  // Native sharing needs the tap itself, so the files are prepared first, as for one result.
  const shareKey = ready.map((item) => item.id).join("\n");
  const [shareFiles, setShareFiles] = useState<{ key: string; files: File[] } | null>(null);
  const prepared = shareFiles?.key === shareKey ? shareFiles.files : null;
  const prepare = useMutation({
    mutationFn: () => Promise.all(ready.map((item) => prepareMediaShare(mediaDownload(item)))),
    onSuccess: (files) => setShareFiles({ key: shareKey, files }),
  });
  async function share() {
    if (!prepared) return prepare.mutate();
    try {
      await navigator.share({ files: prepared });
      settle();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) failure(error);
    }
  }
  async function retrySelected() {
    setBusy("retry");
    try {
      const accepted = await tryAgain(failed.map((job) => job.id));
      settle(
        latestSelection.current.selectedItems
          .filter((item) => item.status === "failed" && !accepted.has(item.jobId || ""))
          .map((item) => item.id),
      );
    } finally {
      setBusy(null);
    }
  }
  async function stopSelected() {
    setBusy("stop");
    try {
      const outcomes = await Promise.allSettled(
        runningJobs.map((id) => cancel.mutateAsync({ id, action: "cancel" })),
      );
      const unstopped = new Set(
        runningJobs.filter((_id, index) => outcomes[index].status === "rejected"),
      );
      settle(
        latestSelection.current.selectedItems
          .filter((item) => unstopped.has(item.jobId || ""))
          .map((item) => item.id),
      );
    } finally {
      setBusy(null);
    }
  }
  const pending = busy !== null;
  // Only what acts on the selection as a whole; an item's own actions stay on its tile and viewer.
  const selectionActions = [
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
    finishedImages.length > 0 &&
      templates.length > 0 &&
      itemAction("animate", {
        loading: animate.isPending,
        menu: assistMenu({
          templates: templates
            .filter((template) => template.id !== "custom")
            .map((template) => ({
              id: `animate-${template.id}`,
              label: template.label,
              icon: icons.animate,
              disabled: animate.isPending,
              onClick: () => animate.mutate(template.id),
            })),
          last: [],
        }),
      }),
    // Each image upscales with Upscale's remembered settings.
    finishedImages.length > 0 &&
      itemAction("upscale", {
        loading: upscale.isPending,
        menu: [
          upscale.settings,
          [
            {
              id: "upscale-run",
              label: "Upscale",
              icon: icons.upscale,
              disabled: upscale.isPending,
              onClick: () =>
                upscale.mutate(undefined, {
                  onSuccess: ({ failed, error }) => {
                    if (error) failure(error);
                    settle(failed);
                  },
                }),
            },
          ],
        ],
      }),
    // Selected uploads run their suggested prompts, one run queued for each; 2–4 images compare.
    (uploads.length > 0 || images) &&
      itemAction("recreate", {
        loading: recreate.isPending || compare.isPending,
        menu: [
          [
            ...(images
              ? [
                  {
                    id: "compare",
                    label: "Compare",
                    icon: icons.compare,
                    disabled: !comparable || compare.isPending || pending,
                    onClick: () => compare.mutate(),
                  },
                ]
              : []),
            ...(uploads.length
              ? [
                  {
                    id: "run-suggested",
                    label: "Run Suggested Prompts",
                    icon: Shuffle,
                    disabled: recreate.isPending,
                    onClick: () =>
                      recreate.mutate(uploads, {
                        onSuccess: ({ failed }) => settle(failed.map((entry) => entry.id)),
                      }),
                  },
                ]
              : []),
          ],
        ],
      }),
    itemAction("share", {
      loading: download.isPending || prepare.isPending,
      menu: [
        [
          {
            id: "download",
            label: "Download",
            icon: icons.download,
            disabled: !ready.length || download.isPending,
            onClick: () => download.mutate(),
          },
          // Phones that share natively also share the files.
          ...(phone && typeof navigator.share === "function"
            ? [
                {
                  id: "share-file",
                  label: "Share",
                  icon: icons.share,
                  disabled: !ready.length || ready.length > shareLimit || prepare.isPending,
                  keepOpen: !prepared,
                  onClick: () => void share(),
                },
              ]
            : []),
        ],
      ],
    }),
    itemAction("like", {
      label: allLiked ? "Unlike" : "Like",
      pressed: allLiked,
      disabled: !ready.length || pending,
      description: ready.length ? undefined : "Nothing selected has finished.",
      onClick: () =>
        ratings.mutate(
          { ids: ready.map((item) => item.id), rating: allLiked ? null : "liked" },
          { onSuccess: () => settle() },
        ),
    }),
    // In the Disliked view, Dislike restores the selection.
    itemAction("dislike", {
      label: allDisliked ? "Restore" : "Dislike",
      pressed: allDisliked,
      disabled: !ready.length || pending,
      description: ready.length ? undefined : "Nothing selected has finished.",
      onClick: () => {
        const ids = ready.map((item) => item.id);
        const was = new Map(ready.map((item) => [item.id, item.rating ?? null]));
        ratings.mutate(
          { ids, rating: allDisliked ? null : "disliked" },
          {
            onSuccess: () => {
              settle();
              // Undo gives each item back the rating it had.
              if (!allDisliked)
                showDisliked(ids.length, () =>
                  (["liked", null] as const).forEach((rating) => {
                    const back = ids.filter((id) => was.get(id) === rating);
                    if (back.length) ratings.mutate({ ids: back, rating });
                  }),
                );
            },
          },
        );
      },
    }),
    itemAction("delete", {
      disabled: !deletable.length || pending,
      description: deletable.length ? undefined : "Stop work in progress before deleting it.",
      onClick: () => setConfirm(true),
    }),
  ];
  const actions = itemActionGroups(selectionActions);
  const menuActions = itemActionGroups(selectionActions, "menu");
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
    // On the document: an open tooltip's Escape stops it there, short of the window.
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, [confirm, pending, selection.end, deletable.length]);
  // Phones name them by what they select (All, None, Failed, In Progress). Each select takes every
  // match of the search and filters, loading the pages not shown yet first. Select None takes Select
  // All's place once everything is selected.
  const [quickPicked, setQuickPicked] = useState("");
  const matching = [
    { id: "select-all", label: "Select All", short: "All", match: () => true },
    {
      id: "select-failed",
      label: "Select Failed",
      short: "Failed",
      match: (item: MediaItem) => item.status === "failed",
    },
    {
      id: "select-running",
      label: "Select In Progress",
      short: "In Progress",
      match: (item: MediaItem) => !finished(item),
    },
  ]
    .map((action) => ({ ...action, shown: selection.items.some(action.match) }))
    .filter(({ id, shown }) => (id === "select-all" ? !selection.all : shown))
    .map(({ match, shown, ...action }) => ({
      ...action,
      disabled: !shown || pending || selection.loading,
      loading: selection.loading && quickPicked === action.id,
      onClick: () => {
        setQuickPicked(action.id);
        selection.selectMatching(match);
      },
    }));
  const none = {
    id: "select-none",
    label: "Select None",
    short: "None",
    disabled: pending,
    loading: false,
    onClick: selection.clear,
  };
  const all = matching.filter((action) => action.id === "select-all");
  const quick = [
    ...all,
    ...(selected.length ? [none] : []),
    ...matching.filter((action) => action.id !== "select-all"),
  ];
  const bar = (
    <ActionBarGroups
      groups={actions}
      labelled={namedItemActions}
      fit={phone}
      stacked={phone}
      menuPosition="bottom-end"
    />
  );
  return (
    <>
      <div className={classes.header} role="group" aria-label="Gallery Selection">
        <Text size="sm" fw={500} role="status" className={classes.count}>
          {selected.length} Selected
        </Text>
        {!phone && <Divider orientation="vertical" className={classes.divider} />}
        <div role="group" aria-label="Quick Select" className={classes.quick}>
          {quick.map((action) => (
            <Button
              key={action.id}
              size="compact-sm"
              variant="subtle"
              color="gray"
              aria-label={action.label}
              disabled={action.disabled}
              loading={action.loading}
              onClick={action.onClick}
            >
              {phone ? action.short : action.label}
            </Button>
          ))}
        </div>
        <div role="group" aria-label="Selected Item Actions" className={classes.actions}>
          {bar}
        </div>
        {!phone && <Divider orientation="vertical" className={classes.divider} />}
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
          <ActionMenuItems groups={menuActions} />
        </Menu.Dropdown>
      </Menu>
      <DeleteMediaDialog
        opened={confirm}
        ids={deletable.map((item) => item.id)}
        close={() => setConfirm(false)}
        onDeleted={(_deleted, failed) => settle(failed)}
      />
    </>
  );
}
