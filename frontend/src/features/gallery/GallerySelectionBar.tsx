import { Button, Divider, Menu, Text } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { failure, post } from "../../api";
import { menuWidth } from "../../theme";
import {
  ActionBarGroups,
  ActionMenuItems,
  submenuParentProps,
  useActionMenuBounds,
} from "../../ui/ActionBar";
import { icons } from "../../ui/icons";
import { layerAbove } from "../../ui/popupClicks";
import { usePhone } from "../../ui/usePhone";
import { assistMenu } from "../generation/AskChange";
import { useQueueAction } from "../generation/Queue";
import { DeleteMediaDialog } from "./DeleteMediaDialog";
import { mediaDownload } from "./download";
import { itemAction, itemActionGroups, namedItemActions } from "./itemActions";
import { useActionProfile } from "./mediaProfiles";
import { prepareMediaShare } from "./mediaShare";
import { finished } from "./MediaTile";
import { useUpscaleMany } from "./UpscaleControls";
import type { GallerySelection } from "./useGallerySelection";
import { useAnimateLengthSetting, useAnimateTemplates, useIterate } from "./useMediaAction";
import { showDisliked, useRatings } from "./useMediaRating";
import { useRecreateMany } from "./useRecreateMany";
import type { useTryAgain } from "./useTryAgain";

import classes from "./GallerySelectionBar.module.css";

const shareLimit = 20;
// Compare Selected sets out up to four images side by side, one per number key.
const compareLimit = 4;

/**
 * The contextual selection bar under the toolbar: the count and quick selects, then at its end the
 * selection's actions. The same actions show as a context menu at
 * `menu` (right-click or Shift+F10).
 */
export function GallerySelectionBar({
  selection,
  tryAgain,
  menu,
  onMenuClose,
  submenus,
}: {
  selection: GallerySelection;
  tryAgain: ReturnType<typeof useTryAgain>;
  menu: { x: number; y: number } | null;
  onMenuClose: () => void;
  submenus: boolean;
}) {
  const phone = usePhone();
  const menuBounds = useActionMenuBounds(menu !== null);
  const [confirm, setConfirm] = useState(false);
  const cancel = useQueueAction();
  const [busy, setBusy] = useState<"retry" | "stop" | null>(null);
  const latestSelection = useRef(selection);
  latestSelection.current = selection;
  /**
   * A finished action leaves selection mode; the items it failed for stay selected, with its error
   * shown by the action itself.
   */
  const settle = (failedIds: string[] = []) => {
    if (latestSelection.current.scope !== selection.scope) return;
    if (failedIds.length) latestSelection.current.retain(failedIds);
    else latestSelection.current.end();
  };
  const selected = selection.selectedItems;
  const ready = selected.filter((item) => item.status === "done" && item.url);
  const running = selected.filter((item) => !finished(item));
  const deletable = selected.filter(finished);
  const retryJobs = new Set(
    selected.flatMap((item) => (item.status === "failed" && item.jobId ? [item.jobId] : [])),
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
  const finishedImages = ready.filter((item) => item.type === "image" && !item.uploaded);
  const upscale = useUpscaleMany(finishedImages);
  const iterate = useIterate();
  const templates = useAnimateTemplates();
  const { menu: profiles, profileId } = useActionProfile("video");
  const length = useAnimateLengthSetting(finishedImages[0], profileId);
  const client = useQueryClient();
  const animate = useMutation({
    mutationFn: async ({ theme, profileId }: { theme: string; profileId?: string }) => {
      const failed: string[] = [];
      let error: unknown;
      for (const item of finishedImages)
        await iterate(item, { kind: "animate", theme, profileId }).catch((reason: unknown) => {
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
      settle();
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
      const accepted = await tryAgain([...retryJobs], selected);
      settle(
        latestSelection.current.selectedItems
          .filter(
            (item) =>
              item.status === "failed" &&
              item.jobId &&
              retryJobs.has(item.jobId) &&
              !accepted.has(item.jobId),
          )
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
    (retryJobs.size > 0 || busy === "retry") &&
      itemAction("retry", {
        disabled: pending || !retryJobs.size,
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
          settings: [length, ...profiles],
          templates: templates
            .filter((template) => template.id !== "custom")
            .map((template) => ({
              id: `animate-${template.id}`,
              label: template.label,
              disabled: animate.isPending || length.loading,
              onClick: () => animate.mutate({ theme: template.id, profileId }),
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
                    icon: icons.shuffle,
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
    // Phones that share natively offer Download and Share; elsewhere Share is Download itself.
    phone && typeof navigator.share === "function"
      ? itemAction("share", {
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
              {
                id: "share-file",
                label: "Share",
                icon: icons.share,
                disabled: !ready.length || ready.length > shareLimit || prepare.isPending,
                keepOpen: !prepared,
                onClick: () => void share(),
              },
            ],
          ],
        })
      : itemAction("share", {
          label: "Download",
          icon: icons.download,
          disabled: !ready.length || download.isPending,
          loading: download.isPending,
          onClick: () => download.mutate(),
        }),
    itemAction("like", {
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
  const quick = [
    ...(
      [
        { label: "All", match: "all" },
        { label: "Failed", match: "failed" },
      ] as const
    ).map(({ match, ...action }) => ({
      ...action,
      disabled:
        pending ||
        !selection.quickReady ||
        Boolean(selection.pending) ||
        (match === "all" ? selection.all : selection.noFailed),
      loading: selection.pending === match,
      onClick: () => void selection.selectMatching(match),
    })),
    {
      label: "None",
      disabled: pending || !selected.length,
      loading: false,
      onClick: selection.clear,
    },
  ];
  return (
    <>
      <div className={classes.header} role="group" aria-label="Gallery Selection">
        <Text size="sm" fw={500} role="status" className={classes.count}>
          {selected.length} Selected
        </Text>
        <Divider orientation="vertical" className={classes.divider} />
        <div role="group" aria-label="Quick Select" className={classes.quick}>
          {quick.map((action) => (
            <Button
              key={action.label}
              size="compact-sm"
              variant="subtle"
              color="gray"
              disabled={action.disabled}
              loading={action.loading}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          ))}
        </div>
        <div role="group" aria-label="Selected Item Actions" className={classes.actions}>
          <ActionBarGroups
            groups={actions}
            labelled={namedItemActions}
            stacked={phone}
            menuPosition="bottom-end"
          />
        </div>
      </div>
      <Menu
        {...(submenus ? submenuParentProps : menuBounds)}
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
          <ActionMenuItems groups={actions} submenus={submenus} />
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
