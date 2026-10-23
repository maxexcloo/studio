import { useEffect, useRef, useState } from "react";
import { ActionIcon, Group, Modal, Tooltip, VisuallyHidden } from "@mantine/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { MediaItem } from "../../types";
import { MediaComparison } from "./MediaComparison";
import { ZoomImage } from "./ZoomImage";
import { DeleteMediaDialog } from "./DeleteMediaDialog";
import { MediaDetails } from "./MediaDetails";
import { MediaJobStatus } from "./MediaJobStatus";
import classes from "./MediaViewer.module.css";

export function MediaViewer({
  item,
  close,
  sessionId,
  items = [item],
  navigate,
}: {
  item: MediaItem;
  close: () => void;
  sessionId?: string;
  items?: MediaItem[];
  navigate?: (item: MediaItem) => void;
}) {
  const viewable = items.filter((candidate) => candidate.url);
  const currentIndex = viewable.findIndex((candidate) => candidate.id === item.id);
  const canNavigate = !!navigate && currentIndex >= 0 && viewable.length > 1;
  const gestureClick = useRef(false);
  function move(direction: -1 | 1) {
    if (!canNavigate) return;
    setCompare(false);
    navigate!(viewable[(currentIndex + direction + viewable.length) % viewable.length]);
  }
  const returnTarget = useRef(document.activeElement as HTMLElement | null);
  const restoreFocus = useRef(true);
  useEffect(
    () => () => {
      const target = returnTarget.current;
      requestAnimationFrame(() => {
        if (restoreFocus.current && target?.isConnected) target.focus({ preventScroll: true });
      });
    },
    [],
  );
  const [deleting, setDeleting] = useState(false);
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
  }, [item.id, item.type]);
  const [compare, setCompare] = useState(false);
  return (
    <>
      <Modal
        opened
        onClose={close}
        closeOnEscape={!deleting}
        title={<VisuallyHidden>Generation</VisuallyHidden>}
        returnFocus={false}
        removeScrollProps={{ allowPinchZoom: true }}
        closeButtonProps={{ "aria-label": "Close Generation" }}
        fullScreen
        classNames={{ content: classes.content, body: classes.body, header: classes.header }}
        onKeyDown={(event) => {
          if (
            !canNavigate ||
            event.defaultPrevented ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            (event.target as Element).closest(
              'input,textarea,select,video,[contenteditable="true"],[role="slider"]',
            )
          )
            return;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
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
          <div className={classes.stage}>
            {canNavigate && (
              <Group className={classes.navigation} justify="space-between" wrap="nowrap">
                <Tooltip label="Previous Generation (←)">
                  <ActionIcon
                    aria-label="Previous Generation"
                    variant="default"
                    size="lg"
                    radius="xl"
                    onClick={(event) => {
                      event.stopPropagation();
                      move(-1);
                    }}
                  >
                    <ChevronLeft size={22} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Next Generation (→)">
                  <ActionIcon
                    aria-label="Next Generation"
                    variant="default"
                    size="lg"
                    radius="xl"
                    onClick={(event) => {
                      event.stopPropagation();
                      move(1);
                    }}
                  >
                    <ChevronRight size={22} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            )}
            {!item.url ? (
              <MediaJobStatus item={item} />
            ) : item.type === "video" ? (
              <video
                ref={video}
                key={item.id}
                src={item.url}
                width={item.width}
                height={item.height}
                controls
                autoPlay={false}
                playsInline
                className={classes.video}
                onClick={(event) => event.stopPropagation()}
              />
            ) : compare && item.upscale?.url ? (
              <div className={classes.comparison} onClick={(event) => event.stopPropagation()}>
                <MediaComparison
                  original={item.url}
                  upscale={item.upscale.url}
                  width={item.width}
                  height={item.height}
                />
              </div>
            ) : (
              <ZoomImage
                key={item.id}
                src={item.upscale?.url || item.url}
                alt={item.prompt || "Generated Image"}
                width={item.width}
                height={item.height}
                navigate={
                  canNavigate
                    ? (direction) => {
                        // A swipe replaces the image before its compatibility click arrives.
                        gestureClick.current = true;
                        requestAnimationFrame(() => {
                          gestureClick.current = false;
                        });
                        move(direction);
                      }
                    : undefined
                }
              />
            )}
          </div>
          <MediaDetails
            item={item}
            sessionId={sessionId}
            compare={compare}
            onCompare={() => setCompare((value) => !value)}
            onDelete={() => setDeleting(true)}
            onAction={() => {
              restoreFocus.current = false;
              close();
            }}
          />
        </div>
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
