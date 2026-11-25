import { Button, Divider, Menu, Text } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { failure, post } from "../../api";
import { menuWidth } from "../../theme";
import { ActionBarGroups, ActionMenuItems, useActionMenuBounds } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";
import { layerAbove } from "../../ui/popupClicks";
import { useLastWhileClosing } from "../../ui/useLastWhileClosing";
import { usePhone } from "../../ui/usePhone";
import { assistMenu } from "../generation/AskChange";
import { useQueueAction } from "../generation/Queue";
import { DeleteMediaDialog } from "./DeleteMediaDialog";
import { mediaDownload } from "./download";
import { itemAction, itemActionGroups, namedItemActions } from "./itemActions";
import { useActionProfile } from "./mediaProfiles";
import { prepareMediaShare } from "./mediaShare";
import { finished } from "./MediaTile";
import { RecreateOnDialog } from "./RecreateOnDialog";
import { useUpscaleMany } from "./UpscaleControls";
import type { GallerySelection } from "./useGallerySelection";
import {
  type AnimateRequest,
  animateProfileQuery,
  useAnimateLengthSetting,
  useAnimateModifiers,
  useAnimateTemplates,
  useIterate,
} from "./useMediaAction";
import { showDisliked, useRatings } from "./useMediaRating";
import { useRecreateMany } from "./useRecreateMany";
import { useRecreateOn } from "./useRecreateOn";
import type { useTryAgain } from "./useTryAgain";
import { galleryViewPath } from "./viewerLink";

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
}: {
  selection: GallerySelection;
  tryAgain: ReturnType<typeof useTryAgain>;
  menu: { x: number; y: number } | null;
  onMenuClose: () => void;
}) {
  const phone = usePhone();
  const menuBounds = useActionMenuBounds(menu !== null);
  // The menu stays where it opened while it fades out.
  const menuAt = useLastWhileClosing(menu);
  const [confirm, setConfirm] = useState(false);
  const [choosingModel, setChoosingModel] = useState(false);
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
  // Recreate On compares each with its own run, so it needs one.
  const recreatable = finishedImages.filter((item) => item.jobId);
  const recreateOn = useRecreateOn();
  const upscale = useUpscaleMany(finishedImages);
  const iterate = useIterate();
  const modifiers = useAnimateModifiers();
  const { menu: profiles, profileId } = useActionProfile("video");
  const firstImage = finishedImages[0];
  const length = useAnimateLengthSetting(firstImage, profileId);
  const animation = useQuery({
    ...animateProfileQuery(firstImage ?? {}, profileId),
    enabled: Boolean(firstImage),
  });
  const templates = useAnimateTemplates(animation.data?.sound);
  const client = useQueryClient();
  const animate = useMutation({
    mutationFn: async (request: AnimateRequest) => {
      const failed: string[] = [];
      let error: unknown;
      for (const item of finishedImages)
        await iterate(item, { ...request, kind: "animate" }).catch((reason: unknown) => {
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
  const comparable = images && selected.every((item) => item.jobId || item.uploaded);
  const compare = useMutation({
    mutationFn: () =>
      post<{ id: string }>("/api/comparisons", {
        jobIds: selected.map((item) => item.jobId ?? ""),
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
  // Only the actions that apply to what's selected show.
  const selectionActions = [
    (retryJobs.size > 0 || busy === "retry") &&
      itemAction("retry", {
        disabled: pending,
        loading: busy === "retry",
        onClick: () => void retrySelected(),
      }),
    (runningJobs.length > 0 || busy === "stop") &&
      itemAction("stop", {
        disabled: pending,
        loading: busy === "stop",
        onClick: () => void stopSelected(),
      }),
    finishedImages.length > 0 &&
      templates.some((template) => template.id !== "custom") &&
      !!animation.data &&
      !animation.isError &&
      itemAction("animate", {
        loading: animate.isPending,
        menu: assistMenu({
          settings: [
            length,
            ...(modifiers.offered.length ? [modifiers.settingsAction()] : []),
            ...profiles,
          ],
          templates: templates
            .filter((template) => template.id !== "custom")
            .map((template) => ({
              id: `animate-${template.id}`,
              label: template.label,
              description: template.description,
              marker: template.uncensored ? icons.uncensored : undefined,
              disabled: animate.isPending || length.loading,
              onClick: () =>
                animate.mutate({ theme: template.id, profileId, modifiers: modifiers.ticked }),
            })),
          last: [],
        }),
      }),
    // Each image upscales with Upscale's remembered settings.
    (upscale.available || upscale.isPending) &&
      itemAction("upscale", {
        loading: upscale.isPending,
        menu: [
          upscale.settings,
          [
            {
              id: "upscale-run",
              label: "Upscale",
              icon: icons.upscale,
              disabled: upscale.isPending || !upscale.canQueue,
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
    // Selected uploads run their suggested prompts, one run queued for each; 2–4 images compare;
    // finished images run again on another model, each beside its original.
    (images || recreatable.length > 0 || uploads.length > 0) &&
      itemAction("recreate", {
        loading: recreate.isPending || compare.isPending || recreateOn.isPending,
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
            ...(recreatable.length
              ? [
                  {
                    id: "recreate-on",
                    label: "Recreate On…",
                    icon: icons.compare,
                    disabled: recreateOn.isPending || pending,
                    onClick: () => setChoosingModel(true),
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
    ready.length > 0 &&
      (phone && typeof navigator.share === "function"
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
          })),
    ready.length > 0 &&
      itemAction("like", {
        pressed: allLiked,
        disabled: pending,
        onClick: () =>
          ratings.mutate(
            { ids: ready.map((item) => item.id), rating: allLiked ? null : "liked" },
            { onSuccess: () => settle() },
          ),
      }),
    // In the Disliked view, Dislike restores the selection.
    ready.length > 0 &&
      itemAction("dislike", {
        pressed: allDisliked,
        disabled: pending,
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
    deletable.length > 0 &&
      itemAction("delete", {
        disabled: pending,
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
        {...menuBounds}
        opened={menu !== null}
        onChange={(opened) => !opened && onMenuClose()}
        width={menuWidth}
      >
        <Menu.Target>
          <div
            aria-hidden
            style={{ position: "fixed", left: menuAt?.x, top: menuAt?.y, width: 0, height: 0 }}
          />
        </Menu.Target>
        <Menu.Dropdown aria-label="Selection Actions">
          {menuAt && (
            <ActionMenuItems
              groups={actions}
              leading={
                <>
                  <Menu.Item leftSection={<X size={16} />} onClick={selection.end}>
                    Exit Selection
                  </Menu.Item>
                  <Menu.Divider />
                </>
              }
            />
          )}
        </Menu.Dropdown>
      </Menu>
      <RecreateOnDialog
        opened={choosingModel}
        count={recreatable.length}
        pending={recreateOn.isPending}
        onClose={() => setChoosingModel(false)}
        onRecreate={(profile) =>
          recreateOn.mutate(
            { items: recreatable, profile },
            {
              onSuccess: ({ comparisons, failed, error }) => {
                setChoosingModel(false);
                if (error) failure(error);
                settle(failed);
                if (failed.length) return;
                // One comparison opens; several wait in Comparisons.
                if (comparisons.length === 1) navigate(`/compare/${comparisons[0]}`);
                else if (comparisons.length) navigate(galleryViewPath("image", "comparisons"));
              },
            },
          )
        }
      />
      <DeleteMediaDialog
        opened={confirm}
        ids={deletable.map((item) => item.id)}
        close={() => setConfirm(false)}
        onDeleted={(_deleted, failed) => settle(failed)}
      />
    </>
  );
}
