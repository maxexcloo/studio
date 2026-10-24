import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Drawer,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
  Transition,
  VisuallyHidden,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { ChevronLeft, ChevronRight, Info, PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { glass } from "../../theme";
import type { MediaItem } from "../../types";
import { useMotionDuration } from "../../ui/Appearance";
import { LoadingState } from "../../ui/LoadingState";
import { usePhone } from "../../ui/usePhone";
import { DeleteMediaDialog } from "./DeleteMediaDialog";
import { MediaDetails } from "./MediaDetails";
import { mediaTitle } from "./mediaLabels";
import { MediaJobStatus } from "./MediaJobStatus";
import classes from "./MediaViewer.module.css";
import { MediaViewerActions } from "./MediaViewerActions";
import { MediaViewerDock, useRunFamily } from "./MediaViewerDock";
import { mediaSource } from "./mediaSource";
import { useMediaIteration } from "./useMediaAction";
import { useMediaFavorite } from "./useMediaFavorite";
const MediaComparison = lazy(() =>
  import("./MediaComparison").then((module) => ({ default: module.MediaComparison })),
);
const ZoomImage = lazy(() =>
  import("./ZoomImage").then((module) => ({ default: module.ZoomImage })),
);

/** Decodes the display copies two either side of the current one, so navigation lands on a picture. */
function useNeighbourPrefetch(items: MediaItem[], index: number) {
  const held = useRef(new Map<string, HTMLImageElement>());
  const urls =
    index < 0 || items.length < 2
      ? []
      : [1, -1, 2, -2]
          .map((offset) => items[(index + offset + items.length) % items.length])
          .filter(
            (item) => item.type === "image" && item.status === "done" && item !== items[index],
          )
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
  const motion = useMotionDuration();
  const [version, setVersion] = useState<{ id: string; active: boolean } | null>(null);
  const displayed = version?.id === item.id ? { ...item, upscaleActive: version.active } : item;
  const source = mediaSource(displayed);
  const favorite = useMediaFavorite(displayed);
  const viewable = items.filter((candidate) => candidate.url);
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
  const [deleting, setDeleting] = useState(false);
  // Runs this viewer queued outside the item's session still join its strip.
  const [queued, setQueued] = useState<string[]>([]);
  const family = useRunFamily(item, queued);
  const iteration = useMediaIteration(item, sessionId);
  const [draft, setDraft] = useState({ id: item.id, prompt: item.prompt || "" });
  const prompt = draft.id === item.id ? draft.prompt : item.prompt || "";
  function iterate(next: Parameters<typeof iteration.mutate>[0]) {
    iteration.mutate(next, { onSuccess: (jobId) => setQueued((ids) => [...ids, jobId]) });
  }
  function move(direction: -1 | 1) {
    if (!canNavigate) return;
    setCompare(false);
    navigate!(viewable[(currentIndex + direction + viewable.length) % viewable.length]);
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
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const media = video.current;
    const pause = () => {
      if (document.hidden) media?.pause();
    };
    document.addEventListener("visibilitychange", pause);
    return () => {
      document.removeEventListener("visibilitychange", pause);
      if (media) {
        media.pause();
        media.removeAttribute("src");
        media.load();
      }
    };
  }, [item.id, item.type, source.url]);
  const subtitle = [
    item.type === "video" ? "Video" : "Image",
    String(item.settings?.profileName || ""),
    source.width ? `${source.width} × ${source.height}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const toggleDetails = () => (phone ? setSheet(true) : setDetails((open) => !open));
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
          onClick={close}
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
                <MediaJobStatus item={item} />
              ) : item.type === "video" ? (
                <video
                  ref={video}
                  key={`${item.id}:${source.url}`}
                  src={source.url}
                  width={source.width}
                  height={source.height}
                  controls
                  autoPlay={false}
                  playsInline
                  className={classes.video}
                  onClick={(event) => event.stopPropagation()}
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
                    width={source.width}
                    height={source.height}
                    swipe={(direction) => {
                      // A swipe replaces the image before its compatibility click arrives.
                      gestureClick.current = true;
                      requestAnimationFrame(() => {
                        gestureClick.current = false;
                      });
                      if (direction === "down") close();
                      else if (direction === "up") setSheet(phone);
                      else move(direction === "left" ? 1 : -1);
                    }}
                  />
                </Suspense>
              )}
            </div>
            <MediaViewerDock
              item={displayed}
              family={family}
              choose={(next) => {
                setCompare(false);
                navigate?.(next);
              }}
              prompt={prompt}
              onPromptChange={(next) => setDraft({ id: item.id, prompt: next })}
              onSubmit={() => iterate({ kind: "variation", prompt })}
              pending={iteration.isPending && iteration.variables?.kind === "variation"}
              actions={
                <MediaViewerActions
                  item={displayed}
                  sessionId={sessionId}
                  compare={compare}
                  iterate={iterate}
                  iterating={iteration.isPending ? iteration.variables?.kind : undefined}
                  onCompare={() => setCompare((value) => !value)}
                  onDelete={() => setDeleting(true)}
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
            <Transition mounted={details} transition="slide-left" duration={motion}>
              {(styles) => (
                <aside
                  className={classes.aside}
                  style={styles}
                  aria-label="Generation Details"
                  onClick={(event) => event.stopPropagation()}
                >
                  <ScrollArea h="100%" type="hover" offsetScrollbars>
                    <Stack gap="lg" p="md" pt="lg">
                      <Stack gap={2}>
                        <Text fw={600} lineClamp={2}>
                          {mediaTitle(item)}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {subtitle}
                        </Text>
                      </Stack>
                      <MediaDetails item={displayed} />
                    </Stack>
                  </ScrollArea>
                </aside>
              )}
            </Transition>
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
          >
            <Stack gap="lg" pb="max(var(--mantine-spacing-md), env(safe-area-inset-bottom))">
              <Text size="xs" c="dimmed" mt={-8}>
                {subtitle}
              </Text>
              <MediaDetails item={displayed} />
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
