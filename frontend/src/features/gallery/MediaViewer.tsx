import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Drawer,
  FocusTrap,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
  VisuallyHidden,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { ChevronLeft, ChevronRight, Info, PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { glass } from "../../theme";
import type { MediaItem } from "../../types";
import { LoadingState } from "../../ui/LoadingState";
import { usePhone } from "../../ui/usePhone";
import { DeleteMediaDialog } from "./DeleteMediaDialog";
import { DetailsCopyActions, MediaDetails } from "./MediaDetails";
import { mediaTitle } from "./mediaLabels";
import { MediaJobStatus } from "./MediaJobStatus";
import classes from "./MediaViewer.module.css";
import { MediaViewerActions } from "./MediaViewerActions";
import { MediaViewerDock, useRunFamily } from "./MediaViewerDock";
import { mediaSource } from "./mediaSource";
import { swipeDirection, type SwipeDirection } from "./swipe";
import { useMediaIteration } from "./useMediaAction";
import { useMediaFavorite } from "./useMediaFavorite";
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
      "button, a[href], input, textarea, video, [role=slider]",
    ),
  ].some((control) => {
    if (
      control.closest(".react-transform-wrapper") ||
      !control.checkVisibility({ opacityProperty: true, visibilityProperty: true })
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

/**
 * Plays each opened video, muted if the browser refuses sound, pauses it while the tab is hidden
 * and releases the player when it leaves. The keyed element gets a fresh call per source.
 */
function playVideo(media: HTMLVideoElement | null) {
  if (!media) return;
  const pause = () => {
    if (document.hidden) media.pause();
  };
  document.addEventListener("visibilitychange", pause);
  media.play().catch((error: DOMException) => {
    if (error.name !== "NotAllowedError" || media.muted) return;
    media.muted = true;
    void media.play().catch(() => {});
  });
  return () => {
    document.removeEventListener("visibilitychange", pause);
    media.pause();
    media.removeAttribute("src");
    media.load();
  };
}

/** The opened video, its controls hidden until a pointer moves over or taps it, then fading again. */
function ViewerVideo({ src, width, height }: { src: string; width?: number; height?: number }) {
  const [controls, setControls] = useState(false);
  const hide = useRef(0);
  useEffect(() => () => clearTimeout(hide.current), []);
  const reveal = () => {
    setControls(true);
    clearTimeout(hide.current);
    hide.current = window.setTimeout(() => setControls(false), 2500);
  };
  return (
    <video
      ref={playVideo}
      src={src}
      width={width}
      height={height}
      controls={controls}
      playsInline
      className={classes.video}
      onPointerMove={reveal}
      onPointerDown={reveal}
      onFocus={reveal}
      onClick={(event) => event.stopPropagation()}
    />
  );
}

/** Decodes the display copies two either side of the current one, so navigation lands on a picture. */
function useNeighbourPrefetch(items: MediaItem[], index: number) {
  const held = useRef(new Map<string, HTMLImageElement>());
  const urls =
    index < 0 || items.length < 2
      ? []
      : [1, -1, 2, -2]
          .map((offset) => items[index + offset])
          .filter((item) => item?.type === "image" && item.status === "done")
          .map((item) => mediaSource(item).url);
  const key = urls.join("\n");
  useEffect(() => {
    const keep = new Map<string, HTMLImageElement>();
    for (const url of urls) {
      let image = held.current.get(url);
      if (!image) {
        image = new window.Image();
        image.decoding = "async";
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
  sessionId,
  items = [item],
  navigate,
  onReturnFocus,
}: {
  item: MediaItem;
  close: () => void;
  sessionId?: string;
  items?: MediaItem[];
  navigate?: (item: MediaItem) => void;
  onReturnFocus?: (item: MediaItem) => void;
}) {
  const phone = usePhone();
  const [version, setVersion] = useState<{ id: string; active: boolean } | null>(null);
  const displayed = version?.id === item.id ? { ...item, upscaleActive: version.active } : item;
  const source = mediaSource(displayed);
  const favorite = useMediaFavorite(displayed);
  // Work still running is viewable while it is the current item, so it navigates like a result.
  const viewable = items.filter((candidate) => candidate.url || candidate.id === item.id);
  const currentIndex = viewable.findIndex((candidate) => candidate.id === item.id);
  const canNavigate = !!navigate && currentIndex >= 0 && viewable.length > 1;
  useNeighbourPrefetch(viewable, currentIndex);
  const gestureClick = useRef(false);
  const [compare, setCompare] = useState(false);
  const [details, setDetails] = useLocalStorage({
    key: "studio-viewer-details",
    defaultValue: true,
    getInitialValueInEffect: false,
  });
  const [sheet, setSheet] = useState(false);
  const [ZoomImage] = useState(() => zoomImage || LazyZoomImage);
  const [deleting, setDeleting] = useState(false);
  // Runs this viewer queued outside the item's session still join its strip.
  const [queued, setQueued] = useState<string[]>([]);
  const family = useRunFamily(item, queued);
  const iteration = useMediaIteration(item, sessionId);
  // An accepted retry removes the failed item; the viewer follows its replacement once listed.
  const [replacement, setReplacement] = useState("");
  useEffect(() => {
    const next = replacement && items.find((candidate) => candidate.jobId === replacement);
    if (!next) return;
    setReplacement("");
    navigate?.(next);
  }, [replacement, items, navigate]);
  const joinStrip = (jobId: string) => setQueued((ids) => [...ids, jobId]);
  function iterate(next: Parameters<typeof iteration.mutate>[0]) {
    iteration.mutate(next, { onSuccess: joinStrip });
  }
  function move(direction: -1 | 1) {
    // Navigation stops at either end rather than wrapping round.
    const next = canNavigate && viewable[currentIndex + direction];
    if (!next) return;
    setCompare(false);
    navigate!(next);
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
        else if (target?.isConnected) target.focus({ preventScroll: true });
      });
    },
    [],
  );
  const subtitle = [
    item.type === "video" ? "Video" : "Image",
    String(item.settings?.profileName || ""),
    source.width ? `${source.width} × ${source.height}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const toggleDetails = () => (phone ? setSheet(true) : setDetails((open) => !open));
  function swipe(direction: SwipeDirection) {
    // A swipe replaces the media before its compatibility click arrives.
    gestureClick.current = true;
    requestAnimationFrame(() => {
      gestureClick.current = false;
    });
    if (direction === "down") close();
    else if (direction === "up") setSheet(phone);
    else move(direction === "left" ? 1 : -1);
  }
  // Running, failed and cancelled work takes the same touch swipes as a picture at Fit.
  const statusSwipe = useRef<{ id: number; x: number; y: number } | null>(null);
  return (
    <>
      <Modal
        opened
        onClose={close}
        // Escape is handled below so nested menus, popovers and sheets close only themselves.
        closeOnEscape={false}
        withCloseButton={false}
        title={<VisuallyHidden>Generation</VisuallyHidden>}
        returnFocus={false}
        removeScrollProps={{ allowPinchZoom: true }}
        fullScreen
        classNames={{ content: classes.content, body: classes.body, header: classes.header }}
        onKeyDownCapture={(event) => {
          // A hovered control's open tooltip would otherwise take the first Escape for itself.
          const target = event.target as Element;
          if (
            event.key === "Escape" &&
            !event.nativeEvent.isComposing &&
            !deleting &&
            event.currentTarget.contains(target) &&
            !target.closest("input,textarea,select,[aria-haspopup]")
          ) {
            event.preventDefault();
            close();
          }
        }}
        onKeyDown={(event) => {
          // Portalled layers (menus, popovers, the details sheet) bubble here through React.
          if (
            deleting ||
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
          if (event.key.toLowerCase() === "f" && item.status === "done" && item.url) {
            event.preventDefault();
            if (!favorite.isPending && !event.repeat) favorite.mutate();
          } else if (event.key === "Delete") {
            event.preventDefault();
            setDeleting(true);
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
          <div className={classes.main}>
            <Group
              className={classes.topBar}
              justify="space-between"
              wrap="nowrap"
              onClick={(event) => event.stopPropagation()}
            >
              {canNavigate ? (
                <Badge variant="default" size="lg" radius="xl" style={glass} fw={500}>
                  {currentIndex + 1} / {viewable.length}
                </Badge>
              ) : (
                <span />
              )}
              <Group gap={6} wrap="nowrap">
                <Tooltip label={phone ? "Details" : details ? "Hide Details" : "Show Details"}>
                  <ActionIcon
                    variant="default"
                    size={phone ? 42 : undefined}
                    aria-label="Generation Details"
                    aria-expanded={phone ? sheet : details}
                    onClick={toggleDetails}
                  >
                    {phone ? (
                      <Info size={18} />
                    ) : details ? (
                      <PanelRightClose size={18} />
                    ) : (
                      <PanelRightOpen size={18} />
                    )}
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Close (Esc)">
                  <ActionIcon
                    variant="default"
                    size={phone ? 42 : undefined}
                    aria-label="Close Generation"
                    onClick={close}
                  >
                    <X size={18} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>
            <div className={classes.stage}>
              {canNavigate && (
                <Group className={classes.navigation} justify="space-between" wrap="nowrap">
                  <Tooltip label="Previous Generation (←)">
                    <ActionIcon
                      aria-label="Previous Generation"
                      variant="default"
                      // Stays focusable at an end, so arrow keys keep working.
                      data-disabled={currentIndex === 0 || undefined}
                      aria-disabled={currentIndex === 0 || undefined}
                      onClick={(event) => {
                        event.stopPropagation();
                        move(-1);
                      }}
                    >
                      <ChevronLeft size={20} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Next Generation (→)">
                    <ActionIcon
                      aria-label="Next Generation"
                      variant="default"
                      data-disabled={currentIndex === viewable.length - 1 || undefined}
                      aria-disabled={currentIndex === viewable.length - 1 || undefined}
                      onClick={(event) => {
                        event.stopPropagation();
                        move(1);
                      }}
                    >
                      <ChevronRight size={20} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              )}
              {!item.url ? (
                <div
                  className={classes.status}
                  onPointerDown={(event) => {
                    statusSwipe.current =
                      event.pointerType === "touch"
                        ? { id: event.pointerId, x: event.clientX, y: event.clientY }
                        : null;
                  }}
                  onPointerUp={(event) => {
                    const start = statusSwipe.current;
                    statusSwipe.current = null;
                    if (start?.id !== event.pointerId) return;
                    const direction = swipeDirection(
                      event.clientX - start.x,
                      event.clientY - start.y,
                    );
                    if (direction) swipe(direction);
                  }}
                >
                  <MediaJobStatus item={item} onRetried={setReplacement} />
                </div>
              ) : item.type === "video" ? (
                <ViewerVideo
                  key={`${item.id}:${source.url}`}
                  src={source.url}
                  width={source.width}
                  height={source.height}
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
                <Suspense fallback={<LoadingState label="Loading Image" fill />}>
                  <ZoomImage
                    key={item.id}
                    src={source.url}
                    alt={item.prompt || "Generated Image"}
                    placeholder={source.thumbnailUrl}
                    width={source.width}
                    height={source.height}
                    swipe={swipe}
                  />
                </Suspense>
              )}
            </div>
            <MediaViewerDock
              item={displayed}
              neighbour={canNavigate ? viewable[currentIndex + 1] : undefined}
              family={family}
              choose={(next) => {
                setCompare(false);
                navigate?.(next);
              }}
              sessionId={sessionId}
              onQueued={joinStrip}
              actions={
                <MediaViewerActions
                  item={displayed}
                  sessionId={sessionId}
                  compare={compare}
                  iterate={iterate}
                  iterating={iteration.isPending ? iteration.variables?.kind : undefined}
                  onCompare={() => setCompare((value) => !value)}
                  onDelete={() => setDeleting(true)}
                  onRetried={setReplacement}
                  onVersionChange={(id, active) => setVersion({ id, active })}
                  onApplied={() => {
                    restoreFocus.current = false;
                    close();
                  }}
                />
              }
            />
          </div>
          {!phone && (
            // The track opens at once so the stage re-centres while the panel slides in.
            <div className={classes.asideTrack} data-open={details || undefined}>
              <aside
                className={classes.aside}
                aria-label="Generation Details"
                onClick={(event) => event.stopPropagation()}
              >
                <ScrollArea h="100%" type="hover" offsetScrollbars>
                  <Stack gap="lg" p="md" pt="lg">
                    <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
                      <Stack gap={2} miw={0}>
                        <Text fw={600} lineClamp={2}>
                          {mediaTitle(item)}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {subtitle}
                        </Text>
                      </Stack>
                      <DetailsCopyActions item={displayed} />
                    </Group>
                    <MediaDetails
                      item={displayed}
                      open={
                        navigate &&
                        ((next) => {
                          setCompare(false);
                          navigate(next);
                        })
                      }
                    />
                  </Stack>
                </ScrollArea>
              </aside>
            </div>
          )}
        </div>
        {phone && (
          <Drawer
            opened={sheet}
            onClose={() => setSheet(false)}
            position="bottom"
            size="80%"
            radius="lg"
            title={mediaTitle(item)}
            closeButtonProps={{ "aria-label": "Close Details" }}
            // The title scrolls away with the details instead of staying pinned.
            styles={{ header: { position: "static" } }}
          >
            <FocusTrap.InitialFocus />
            <Stack gap="lg" pb="max(var(--mantine-spacing-md), env(safe-area-inset-bottom))">
              <Group justify="space-between" wrap="nowrap" gap="xs" mt={-8}>
                <Text size="xs" c="dimmed">
                  {subtitle}
                </Text>
                <DetailsCopyActions item={displayed} />
              </Group>
              <MediaDetails
                item={displayed}
                open={
                  navigate &&
                  ((next) => {
                    setCompare(false);
                    navigate(next);
                  })
                }
              />
            </Stack>
          </Drawer>
        )}
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
