import {
  ActionIcon,
  Badge,
  Group,
  Modal,
  Tooltip,
  UnstyledButton,
  VisuallyHidden,
  getDefaultZIndex,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { glass } from "../../theme";
import type { MediaItem } from "../../types";
import { ActionBarSurface, type ActionGroups, findAction, usualAction } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { closingPopup, layerAbove } from "../../ui/popupClicks";
import { usePhone } from "../../ui/usePhone";
import { useRemembered } from "../auth/useRemembered";
import { queueQuery } from "../generation/Queue";
import { DeleteMediaDialog } from "./DeleteMediaDialog";
import { MediaJobStatus } from "./MediaJobStatus";
import { mediaTitle } from "./mediaLabels";
import { mediaSource, playbackUrl } from "./mediaSource";
import { MediaViewerActions, ViewerActionGroups, type ViewerActions } from "./MediaViewerActions";
import { MediaViewerDock, type QueuedRun, useRunFamily } from "./MediaViewerDock";
import { setMembers, setPosition } from "./resultSets";
import type { SwipeDirection } from "./swipe";
import { type Iteration, useMediaIteration } from "./useMediaAction";
import { useMediaRating } from "./useMediaRating";
import { useVideoSound } from "./useVideoSound";
import { playVideo } from "./videoPlayback";
import { VideoPlayButton } from "./VideoPlayButton";
import { ViewerChrome } from "./ViewerChrome";
import { ViewerDetails } from "./ViewerDetails";
import { Neighbour, useStrip, useTouchSwipe } from "./ViewerMediaStrip";

import classes from "./MediaViewer.module.css";
const MediaComparison = lazy(() =>
  import("./MediaComparison").then((module) => ({ default: module.MediaComparison })),
);
// The image chunk loads once the page is idle; a viewer opened after that renders it directly
// instead of flashing the Suspense fallback.
let zoomImage: typeof import("./ZoomImage").ZoomImage | undefined;
const loadZoomImage = () =>
  import("./ZoomImage").then((module) => ({ default: (zoomImage = module.ZoomImage) }));
const LazyZoomImage = lazy(loadZoomImage);
(window.requestIdleCallback || setTimeout)(() => void loadZoomImage());

// Clicks this close to a visible control are near-misses, not a request to close. The zoomable
// picture is not a control: a click just outside the image still closes.
const deadZone = 24;
function nearControl(event: React.MouseEvent<HTMLElement>) {
  return [
    ...event.currentTarget.querySelectorAll(
      `button, a[href], input, textarea, video, [role=slider], .${classes.dock} > *`,
    ),
  ].some((control) => {
    if (
      control.closest(".react-transform-wrapper, [inert]") ||
      !control.checkVisibility({ visibilityProperty: true })
    )
      return false;
    const box = control.getBoundingClientRect();
    return (
      event.clientX > box.left - deadZone &&
      event.clientX < box.right + deadZone &&
      event.clientY > box.top - deadZone &&
      event.clientY < box.bottom + deadZone
    );
  });
}

// One key runs a viewer action, as its bar would (Settings › Studio lists them).
const viewerShortcuts: Record<string, string> = {
  e: "edit-image",
  p: "prompt-composer",
  r: "new-seed",
  u: "upscale",
};

/**
 * The opened video, its controls hidden until a pointer moves over or taps it, then fading again.
 * A touch tap while they are hidden also toggles the gallery's bottom controls; taps while they show
 * work them.
 */
function ViewerVideo({
  id,
  src,
  poster,
  width,
  height,
  swipe,
  onTap,
  hideControls,
}: {
  /** The item's id, so Use Frame as Reference finds the frame showing. */
  id: string;
  src: string;
  /** Its still, shown until the first frame plays (iOS shows nothing before then). */
  poster?: string;
  width?: number;
  height?: number;
  swipe: ReturnType<typeof useTouchSwipe>;
  onTap?: () => void;
  hideControls?: boolean;
}) {
  const { muted, onVolumeChange } = useVideoSound();
  const player = useRef<HTMLVideoElement>(null);
  const [controls, setControls] = useState(false);
  const [refused, setRefused] = useState(false);
  const play = useCallback((media: HTMLVideoElement | null) => {
    if (!media) return;
    player.current = media;
    const release = playVideo(media, () => setRefused(true));
    return () => {
      player.current = null;
      release();
    };
  }, []);
  const hide = useRef(0);
  useEffect(() => () => clearTimeout(hide.current), []);
  const reveal = () => {
    setControls(true);
    clearTimeout(hide.current);
    hide.current = window.setTimeout(() => setControls(false), 2500);
  };
  const tap = (video: HTMLVideoElement, y: number) => {
    const nearPlaybackControls = video.controls && video.getBoundingClientRect().bottom - y < 44;
    if (!nearPlaybackControls && !refused && !closingPopup()) onTap?.();
    reveal();
  };
  return (
    <>
      <video
        ref={play}
        muted={muted}
        onVolumeChange={onVolumeChange}
        onPlaying={() => setRefused(false)}
        data-media-id={id}
        src={src}
        poster={poster}
        width={width}
        height={height}
        controls={(!hideControls && controls) || refused}
        // Generated clips are short, so they repeat like a live photo.
        loop
        playsInline
        className={classes.video}
        onPointerMove={(event) => {
          if (event.pointerType !== "touch") reveal();
          swipe.onPointerMove(event);
        }}
        onPointerCancel={swipe.onPointerCancel}
        onPointerDown={swipe.onPointerDown}
        onPointerUp={(event) => {
          if (
            swipe.onPointerUp(event) ||
            (onTap && event.pointerType === "mouse" && event.button === 0)
          )
            tap(event.currentTarget, event.clientY);
        }}
        onFocus={reveal}
        onClick={(event) => event.stopPropagation()}
      />
      {refused && (
        <VideoPlayButton
          {...swipe}
          play={() => void player.current?.play().catch(() => undefined)}
        />
      )}
    </>
  );
}

/**
 * Decodes the display copies (a video's still) two either side of the current one, so navigation
 * lands on a picture.
 */
function useNeighbourPrefetch(items: MediaItem[], index: number) {
  const held = useRef(new Map<string, HTMLImageElement>());
  const urls =
    index < 0 || items.length < 2
      ? []
      : [1, -1, 2, -2]
          .map((offset) => items[index + offset])
          .filter((item) => item?.url && item.status === "done")
          .map((item) =>
            item.type === "video" ? mediaSource(item).thumbnailUrl : mediaSource(item).displayUrl,
          )
          .filter((url) => url !== undefined);
  const key = urls.join("\n");
  useEffect(() => {
    const keep = new Map<string, HTMLImageElement>();
    for (const url of urls) {
      let image = held.current.get(url);
      if (!image) {
        image = new window.Image();
        image.decoding = "async";
        image.fetchPriority = "low";
        image.src = url;
        void image.decode().catch(() => {});
      }
      keep.set(url, image);
    }
    for (const [url, image] of held.current) if (!keep.has(url)) image.src = "";
    held.current = keep;
  }, [key]);
}

export function MediaViewer({
  item,
  close,
  items = [item],
  related = items,
  total,
  navigate,
  follow,
  onReturnFocus,
  actions,
  itemLabel,
  sideBySide = false,
  bare = false,
  quiet = false,
}: {
  item: MediaItem;
  close: () => void;
  items?: MediaItem[];
  /** The loaded items the version strip and Details › From and Derived look among; `items` by default. */
  related?: MediaItem[];
  /** How many items match, where `items` are only those loaded so far. */
  total?: number;
  navigate?: (item: MediaItem) => void;
  /** Opens a result Details links to as a step of its own; elsewhere the link leaves for the gallery. */
  follow?: (item: MediaItem) => void;
  onReturnFocus?: (item: MediaItem) => void;
  /** The opening surface's own actions, in place of the item's prompt field and actions. */
  actions?: ViewerActions;
  /** Names each item: the shown one's name takes the position badge's place. */
  itemLabel?: (item: MediaItem) => string;
  /** Offers the items side by side on desktop, as the first action in the bar. */
  sideBySide?: boolean;
  /** Only the media and its navigation, over any dialog: no details, actions or item keys. */
  bare?: boolean;
  /** The gallery opens with its actions and leaves thumbnails collapsed. */
  quiet?: boolean;
}) {
  const phone = usePhone();
  const noun = bare ? "Image" : "Generation";
  const [together, setTogether] = useState(false);
  const [version, setVersion] = useState<{ id: string; active: boolean } | null>(null);
  // An accepted retry follows its replacement only while the failed item is still shown.
  const [replacement, setReplacement] = useState<{ from: string; job: string } | null>(null);
  const displayed = version?.id === item.id ? { ...item, upscaleActive: version.active } : item;
  const source = mediaSource(displayed);
  const rating = useMediaRating(displayed);
  // Work still running is viewable while it is the current item, so it navigates like a result.
  const viewable = items.filter((candidate) => candidate.url || candidate.id === item.id);
  const currentIndex = viewable.findIndex((candidate) => candidate.id === item.id);
  const canNavigate = !!navigate && currentIndex >= 0 && viewable.length > 1;
  const showTogether = together && sideBySide && canNavigate && !phone;
  useNeighbourPrefetch(viewable, currentIndex);
  const gestureClick = useRef(false);
  const [compare, setCompare] = useState(false);
  const [localDetails, setLocalDetails] = useState(false);
  const [rememberedDetails, setRememberedDetails] = useRemembered("viewer-details", true);
  const [details, setDetails] =
    quiet || bare ? [localDetails, setLocalDetails] : [rememberedDetails, setRememberedDetails];
  const [sheet, setSheet] = useState(false);
  const detailsOpen = phone ? sheet : details;
  const [chrome, setChrome] = useState<"standard" | "full" | "image">("standard");
  const immersive = quiet && chrome === "image";
  const actionsOpen = !immersive && !sheet;
  const thumbnailsOpen = !quiet || chrome === "full";
  // Navigation replaces the media, and focus on it would fall out of the viewer beyond its keys.
  const stage = useRef<HTMLDivElement>(null);
  function cycleChrome() {
    stage.current?.focus({ preventScroll: true });
    setChrome((shown) => (shown === "standard" ? "full" : shown === "full" ? "image" : "standard"));
  }
  const containStage = useCallback((view: HTMLDivElement | null) => {
    stage.current = view;
    // Keys reach the viewer from the start, before the dialog's own focus lands on its control.
    view?.focus({ preventScroll: true });
  }, []);
  // An action that turns busy disables its button, so focus falls to the page (a menu's return to
  // it too); the stage takes focus back and the key that landed on the page.
  useEffect(() => {
    const regain = (event: KeyboardEvent) => {
      const view = stage.current;
      if (event.target !== document.body || !view || layerAbove(view)) return;
      view.focus();
      const { key, code, altKey, ctrlKey, metaKey, shiftKey, repeat } = event;
      const again = new KeyboardEvent("keydown", {
        key,
        code,
        altKey,
        ctrlKey,
        metaKey,
        shiftKey,
        repeat,
        bubbles: true,
        cancelable: true,
      });
      if (!view.dispatchEvent(again)) event.preventDefault();
    };
    document.addEventListener("keydown", regain);
    return () => document.removeEventListener("keydown", regain);
  }, []);
  const shownId = useRef(item.id);
  useLayoutEffect(() => {
    if (shownId.current !== item.id) {
      setReplacement(null);
      setVersion(null);
      if (document.activeElement === document.body && !layerAbove(stage.current))
        stage.current?.focus({ preventScroll: true });
    }
    shownId.current = item.id;
  }, [item.id]);
  const [ZoomImage] = useState(() => zoomImage || LazyZoomImage);
  const [deleting, setDeleting] = useState(false);
  const shortcutActions = useRef<ActionGroups>([]);
  // Runs this viewer queued outside the item's session still join their source's strip.
  const [queued, setQueued] = useState<QueuedRun[]>([]);
  const jobs = useQuery(queueQuery).data?.jobs;
  const family = useRunFamily(item, queued, related, jobs);
  const members = setMembers(related, item);
  const hasRelatedThumbnails = family.length > 1 || members.length > 1;
  const nearby =
    quiet && thumbnailsOpen && !hasRelatedThumbnails
      ? currentIndex < 0
        ? [displayed]
        : viewable.slice(Math.max(0, currentIndex - 4), currentIndex + 5)
      : undefined;
  function showDetails() {
    if (phone) setSheet(true);
    else {
      if (immersive) setChrome("standard");
      setDetails(true);
    }
  }
  const position =
    canNavigate && itemLabel
      ? itemLabel(item)
      : item.resultSet
        ? setPosition(item, members)
        : canNavigate
          ? `${currentIndex + 1} / ${Math.max(total ?? 0, viewable.length)}`
          : undefined;
  const iteration = useMediaIteration(item);
  const rememberQueued = (job: string) => setQueued((runs) => [...runs, { job, from: item.id }]);
  const closeForPrompt = () => {
    if (phone && shownId.current === item.id && !strip.settling.current) close();
  };
  // The run belongs to the item it started on, even once the viewer has moved on.
  function iterate(next: Iteration) {
    // A phone's prompt editor runs and returns to the gallery; desktop keeps the run in the strip.
    if (next.kind === "prompt") closeForPrompt();
    void iteration.mutateAsync(next).then(rememberQueued, () => {});
  }
  const pending = iteration.variables;
  function move(direction: -1 | 1) {
    if (deleting || layerAbove(stage.current)) return;
    // Navigation stops at either end rather than wrapping round.
    const next = canNavigate && viewable[currentIndex + direction];
    if (!next) return;
    setCompare(false);
    navigate!(next);
    return next;
  }
  const returnTarget = useRef(document.activeElement as HTMLElement | null);
  const restoreFocus = useRef(true);
  const currentReturn = useRef({ item, onReturnFocus });
  currentReturn.current = { item, onReturnFocus };
  useEffect(
    () => () => {
      const target = returnTarget.current;
      requestAnimationFrame(() => {
        if (!restoreFocus.current) return;
        const current = currentReturn.current;
        if (current.onReturnFocus) current.onReturnFocus(current.item);
        else if (document.activeElement === document.body && target?.isConnected)
          target.focus({ preventScroll: true });
      });
    },
    [],
  );
  const detailsSurface = (
    <ViewerDetails
      item={displayed}
      title={mediaTitle(item)}
      related={related}
      follow={
        follow &&
        ((next) => {
          setCompare(false);
          follow(next);
        })
      }
      opened={detailsOpen}
      hidden={immersive}
      phone={phone}
      zIndex={bare ? getDefaultZIndex("max") : undefined}
      close={() => setSheet(false)}
    />
  );
  const toggleDetails = () => {
    if (phone) setSheet(true);
    else setDetails((open) => !open);
  };
  function swipe(direction: SwipeDirection) {
    if (deleting || layerAbove(stage.current)) return false;
    // A swipe replaces the media before its compatibility click arrives.
    gestureClick.current = true;
    requestAnimationFrame(() => {
      gestureClick.current = false;
    });
    if (direction === "down") close();
    else if (direction === "up") showDetails();
    else return Boolean(move(direction === "left" ? 1 : -1));
    return false;
  }
  const previous = canNavigate ? viewable[currentIndex - 1] : undefined;
  const next = canNavigate ? viewable[currentIndex + 1] : undefined;
  const strip = useStrip({ previous: Boolean(previous), next: Boolean(next) }, swipe);
  useLayoutEffect(() => strip.arrived(), [item.id]);
  const onRetried = (job: string) => {
    if (shownId.current === item.id && !strip.settling.current)
      setReplacement({ from: item.id, job });
  };
  useEffect(() => {
    if (replacement?.from !== item.id || deleting) return;
    const retried = related.find((candidate) => candidate.jobId === replacement.job);
    if (!retried) return;
    setReplacement(null);
    if (!strip.settling.current) navigate?.(retried);
  }, [replacement, item.id, related, navigate, deleting, strip.settling]);
  // Running, failed and cancelled work and videos take the same touch swipes as a picture at Fit.
  const touchSwipe = useTouchSwipe(strip.gesture);
  return (
    <>
      <Modal
        opened
        onClose={close}
        // Escape is handled below so nested menus, popovers and sheets close only themselves.
        closeOnEscape={false}
        withCloseButton={false}
        title={<VisuallyHidden>{bare ? "Preview" : "Generation"}</VisuallyHidden>}
        // Over the popover or dialog a bare viewer opens from.
        zIndex={bare ? getDefaultZIndex("max") : undefined}
        returnFocus={false}
        removeScrollProps={{ allowPinchZoom: true }}
        fullScreen
        classNames={{
          content: classes.content,
          body: classes.body,
          header: classes.header,
          overlay: classes.overlay,
        }}
        onKeyDownCapture={(event) => {
          // A hovered control's open tooltip would otherwise take the first Escape for itself.
          const target = event.target as Element;
          if (
            event.key === "Escape" &&
            !event.nativeEvent.isComposing &&
            !deleting &&
            !layerAbove(stage.current, event) &&
            event.currentTarget.contains(target) &&
            !target.closest(
              'input:not([type="radio"]),textarea,select,[aria-haspopup][aria-expanded="true"]',
            )
          ) {
            event.preventDefault();
            close();
          }
        }}
        onKeyDown={(event) => {
          // Portalled layers (menus, popovers, the details sheet) bubble here through React.
          if (
            deleting ||
            layerAbove(stage.current, event) ||
            event.defaultPrevented ||
            !event.currentTarget.contains(event.target as Node)
          )
            return;
          if (event.key === "Escape" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            close();
            return;
          }
          if (
            event.nativeEvent.isComposing ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            (event.target as Element).closest(
              'input,textarea,select,video,[contenteditable="true"],[role="slider"],[role="menu"],[role="listbox"]',
            )
          )
            return;
          // A surface's own actions take E for their Edit and F for their Like, and leave Delete alone.
          const shortcut =
            !bare &&
            (actions ? { ...viewerShortcuts, e: "edit", f: "like" } : viewerShortcuts)[
              event.key.toLowerCase()
            ];
          const found =
            shortcut && findAction(actions?.groups ?? shortcutActions.current, shortcut);
          if (found) {
            event.preventDefault();
            // A control with options runs its first, as a click on it would.
            const action = usualAction(found);
            if (
              action?.onClick &&
              !found.disabled &&
              !action.disabled &&
              !action.loading &&
              !event.repeat
            ) {
              if (immersive) flushSync(() => setChrome("standard"));
              action.onClick();
            }
          } else if (
            !actions &&
            !bare &&
            event.key.toLowerCase() === "f" &&
            item.status === "done" &&
            item.url
          ) {
            event.preventDefault();
            if (!event.repeat) rating.like();
          } else if (!actions && !bare && event.key === "Delete") {
            event.preventDefault();
            setDeleting(true);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            showDetails();
          } else if (quiet && event.key.toLowerCase() === "c") {
            event.preventDefault();
            if (!event.repeat) cycleChrome();
          } else if (canNavigate && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
            event.preventDefault();
            move(event.key === "ArrowLeft" ? -1 : 1);
          }
        }}
      >
        <div
          className={classes.layout}
          onClickCapture={(event) => {
            if (!gestureClick.current) return;
            event.preventDefault();
            event.stopPropagation();
            gestureClick.current = false;
          }}
          onClick={(event) => {
            if (!nearControl(event)) close();
          }}
        >
          <div
            className={classes.main}
            data-docked={!bare || undefined}
            data-viewer-chrome={quiet ? chrome : undefined}
            onPointerMove={(event) => {
              if (
                quiet &&
                chrome === "standard" &&
                event.pointerType === "mouse" &&
                window.innerHeight - event.clientY < 12 &&
                !layerAbove(stage.current)
              )
                setChrome("full");
            }}
          >
            <ViewerChrome
              item={displayed}
              label={
                position && (
                  <VisuallyHidden role="status" aria-label="Current Result">
                    {position}
                  </VisuallyHidden>
                )
              }
              hidden={immersive}
              details={{ opened: detailsOpen, phone, toggle: toggleDetails }}
              focusClose={bare}
              closeLabel={bare ? "Close Preview" : "Close Generation"}
              close={close}
            />
            <div
              ref={containStage}
              className={`${classes.stage} ${classes.viewerStage}`}
              data-viewer-stage
              tabIndex={-1}
              onPointerDown={(event) => {
                // The zoom library cancels mouse down to pan, so the prompt won't blur on its own.
                if (
                  !phone &&
                  event.button === 0 &&
                  document.activeElement?.closest(`.${classes.promptRow}`) &&
                  !layerAbove(event.currentTarget)
                )
                  event.currentTarget.focus({ preventScroll: true });
              }}
            >
              {showTogether ? (
                // Each side opens alone; the current one, whose details show, is outlined.
                <div className={classes.together}>
                  {viewable.map((candidate) => (
                    <UnstyledButton
                      key={candidate.id}
                      className={classes.side}
                      aria-current={candidate.id === item.id || undefined}
                      aria-label={`Show ${itemLabel?.(candidate) ?? "Item"} Alone`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setTogether(false);
                        if (candidate.id !== item.id) navigate!(candidate);
                      }}
                    >
                      <img
                        src={
                          candidate.type === "video"
                            ? mediaSource(candidate).thumbnailUrl
                            : mediaSource(candidate).displayUrl
                        }
                        alt={candidate.prompt || "Generated Image"}
                        draggable={false}
                      />
                      {itemLabel && (
                        <Badge
                          className={classes.sideLabel}
                          variant="default"
                          size="lg"
                          radius="xl"
                          style={glass}
                          fw={500}
                        >
                          {itemLabel(candidate)}
                        </Badge>
                      )}
                    </UnstyledButton>
                  ))}
                </div>
              ) : (
                <>
                  {/* Phones swipe between items instead. */}
                  {canNavigate && !phone && !immersive && (
                    <Group
                      className={classes.navigation}
                      data-chrome
                      justify="space-between"
                      wrap="nowrap"
                    >
                      <Tooltip label={`Previous ${noun} (←)`}>
                        <ActionIcon
                          aria-label={`Previous ${noun}`}
                          variant="default"
                          // Stays focusable at an end, so arrow keys keep working.
                          data-disabled={currentIndex === 0 || undefined}
                          aria-disabled={currentIndex === 0 || undefined}
                          onClick={(event) => {
                            event.stopPropagation();
                            move(-1);
                          }}
                        >
                          <icons.previous size={20} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label={`Next ${noun} (→)`}>
                        <ActionIcon
                          aria-label={`Next ${noun}`}
                          variant="default"
                          data-disabled={currentIndex === viewable.length - 1 || undefined}
                          aria-disabled={currentIndex === viewable.length - 1 || undefined}
                          onClick={(event) => {
                            event.stopPropagation();
                            move(1);
                          }}
                        >
                          <icons.next size={20} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  )}
                  <div ref={strip.ref} className={classes.mediaStrip}>
                    <Neighbour item={previous} side="previous" />
                    {!item.url ? (
                      <div className={classes.status} {...touchSwipe}>
                        <MediaJobStatus key={item.id} item={item} onRetried={onRetried} />
                      </div>
                    ) : item.type === "video" ? (
                      <ViewerVideo
                        key={`${item.id}:${source.url}`}
                        id={item.id}
                        src={playbackUrl(source.url)}
                        poster={source.thumbnailUrl}
                        width={source.width}
                        height={source.height}
                        swipe={touchSwipe}
                        onTap={quiet ? cycleChrome : undefined}
                        hideControls={immersive}
                      />
                    ) : compare && item.upscale?.url ? (
                      <div className={classes.comparison}>
                        <Suspense fallback={<LoadingState label="Loading Comparison" fill />}>
                          <MediaComparison
                            original={item.url}
                            upscale={item.upscale.url}
                            width={item.width}
                            height={item.height}
                          />
                        </Suspense>
                      </div>
                    ) : (
                      <Suspense
                        fallback={
                          source.thumbnailUrl ? (
                            <img
                              src={source.thumbnailUrl}
                              alt=""
                              aria-hidden
                              className={classes.viewerPlaceholder}
                              width={source.width}
                              height={source.height}
                              draggable={false}
                              onClick={(event) => event.stopPropagation()}
                            />
                          ) : (
                            <LoadingState label="Loading Image" fill />
                          )
                        }
                      >
                        <ZoomImage
                          mediaId={item.id}
                          src={source.displayUrl}
                          original={source.url}
                          alt={item.prompt || "Generated Image"}
                          placeholder={source.thumbnailUrl}
                          width={source.width}
                          height={source.height}
                          swipe={strip.gesture}
                          onTap={quiet ? cycleChrome : undefined}
                          hideControls={immersive}
                        />
                      </Suspense>
                    )}
                    <Neighbour item={next} side="next" />
                  </div>
                </>
              )}
            </div>
            {!bare && (
              <div
                className={classes.dockedControls}
                hidden={immersive}
                data-actions-hidden={sheet || undefined}
                inert={!actionsOpen}
                onClick={(event) => event.stopPropagation()}
              >
                <MediaViewerDock
                  item={displayed}
                  family={family}
                  jobs={jobs}
                  set={members}
                  nearby={nearby}
                  showThumbnails={thumbnailsOpen}
                  choose={(next) => {
                    setCompare(false);
                    navigate?.(next);
                  }}
                  actions={
                    actions ? (
                      <ActionBarSurface
                        aria-label={actions.label}
                        radius="lg"
                        className={classes.actions}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <ViewerActionGroups
                          groups={
                            sideBySide && canNavigate && !phone
                              ? [
                                  [
                                    {
                                      id: "side-by-side",
                                      label: "Side by Side",
                                      icon: icons.compareSideBySide,
                                      pressed: together,
                                      onClick: () => setTogether((value) => !value),
                                    },
                                  ],
                                  ...actions.groups,
                                ]
                              : actions.groups
                          }
                          labelled={[...actions.labelled, "side-by-side"]}
                          equal={actions.equal}
                        />
                      </ActionBarSurface>
                    ) : (
                      <MediaViewerActions
                        key={displayed.id}
                        item={displayed}
                        compare={compare}
                        iterate={iterate}
                        pending={pending}
                        onCompare={() => {
                          if (!compare && phone && quiet && hasRelatedThumbnails) setChrome("full");
                          setCompare(!compare);
                        }}
                        onDelete={() => setDeleting(true)}
                        onReportQueued={(job) => {
                          rememberQueued(job);
                          closeForPrompt();
                        }}
                        onRetried={onRetried}
                        onVersionChange={(id, active) => {
                          if (shownId.current === id) setVersion({ id, active });
                        }}
                        shortcuts={shortcutActions}
                        onApplied={() => {
                          restoreFocus.current = false;
                          close();
                        }}
                      />
                    )
                  }
                />
              </div>
            )}
          </div>
          {!phone && detailsSurface}
        </div>
        {phone && detailsSurface}
      </Modal>
      <DeleteMediaDialog
        opened={deleting}
        ids={[item.id]}
        close={() => setDeleting(false)}
        onDeleted={(deleted) => {
          if (deleted.includes(item.id)) close();
        }}
      />
    </>
  );
}
