import { useEffect, useId, useRef, useState } from "react";
import {
  ActionIcon,
  Button,
  Collapse,
  Group,
  Modal,
  Paper,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
  UnstyledButton,
  VisuallyHidden,
} from "@mantine/core";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { notifications } from "@mantine/notifications";
import { api, failure } from "../../api";
import type { MediaItem } from "../../types";
import { copyText } from "../../ui/clipboard";
import { MediaComparison } from "./MediaComparison";
import { useMediaAction } from "./useMediaAction";
import { ZoomImage } from "./ZoomImage";
import { mediaDownload } from "./download";
import classes from "./MediaViewer.module.css";

function generationTitle(prompt = "") {
  const plain = prompt
    .replace(/<[^>]*>/g, " ")
    .replace(/[()[\]{}]/g, "")
    .replace(/:\s*-?\d+(\.\d+)?/g, "")
    .trim();
  const line = plain.split(/[,.;|\n]/)[0].trim() || plain;
  const text = line.length > 64 ? `${line.slice(0, 61).replace(/\s+\S*$/, "")}…` : line;
  return text ? text[0].toUpperCase() + text.slice(1) : "Untitled Generation";
}

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
  const client = useQueryClient();
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
  const [details, setDetails] = useState(false);
  const detailsId = useId();
  const swipe = useRef<{ x: number; y: number; moved: boolean } | null>(null);
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
  const action = useMediaAction(item, sessionId, () => {
    restoreFocus.current = false;
    close();
  });
  const mutate = useMutation({
    mutationFn: ({ path, body, method }: { path: string; body?: unknown; method?: string }) =>
      api(path, { method: method || "POST", body: body ? JSON.stringify(body) : undefined }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["gallery"] });
    },
    onError: failure,
  });
  return (
    <Modal
      opened
      onClose={close}
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
          {item.type === "video" ? (
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
        <Paper
          withBorder
          radius="lg"
          p="sm"
          className={classes.rail}
          onClick={(event) => event.stopPropagation()}
        >
          <Stack gap="xs">
            <UnstyledButton
              className={classes.handle}
              aria-label="Generation Details"
              aria-expanded={details}
              aria-controls={detailsId}
              onPointerDown={(event) => {
                swipe.current = { x: event.clientX, y: event.clientY, moved: false };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerUp={(event) => {
                const start = swipe.current;
                if (!start) return;
                const dy = event.clientY - start.y;
                if (Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(event.clientX - start.x)) {
                  setDetails(dy < 0);
                  start.moved = true;
                }
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => {
                swipe.current = null;
              }}
              onClick={() => {
                if (!swipe.current?.moved) setDetails((value) => !value);
                swipe.current = null;
              }}
            >
              <div className={classes.handleLine} />
              <Group justify="space-between" wrap="nowrap">
                <Stack gap={2} style={{ minWidth: 0 }}>
                  <Text fw={600} size="sm" lineClamp={1}>
                    {generationTitle(item.prompt)}
                  </Text>
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {item.type === "video" ? "Video" : "Image"}
                    {item.width ? ` · ${item.width} × ${item.height}` : ""}
                    {item.model ? ` · ${item.model}` : ""}
                  </Text>
                </Stack>
                {details ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              </Group>
            </UnstyledButton>
            <Group gap="xs">
              <Button component="a" {...mediaDownload(item)} variant="default" size="compact-sm">
                Download
              </Button>
              <Button
                size="compact-sm"
                loading={action.isPending}
                onClick={() => action.mutate(item.type === "video" ? "extend" : "refine")}
              >
                {item.type === "video" ? "Extend" : "Refine"}
              </Button>
              {item.type === "image" && (
                <Button
                  size="compact-sm"
                  variant="light"
                  loading={action.isPending}
                  onClick={() => action.mutate("animate")}
                >
                  Animate
                </Button>
              )}
            </Group>
            <Collapse expanded={details} id={detailsId}>
              <Stack className={classes.details} gap="md">
                <Group gap="xs">
                  <Button
                    variant="default"
                    size="compact-sm"
                    onClick={() => {
                      void copyText(item.prompt || "")
                        .then(() => notifications.show({ message: "Prompt copied" }))
                        .catch(failure);
                    }}
                  >
                    Copy Prompt
                  </Button>
                  <Button
                    variant="default"
                    size="compact-sm"
                    loading={action.isPending}
                    onClick={() => action.mutate("image")}
                  >
                    Recreate
                  </Button>
                  <Button
                    variant="subtle"
                    size="compact-sm"
                    onClick={() =>
                      mutate.mutate({
                        path: "/api/gallery/favorite",
                        body: { ids: [item.id], favorite: !item.favorite },
                      })
                    }
                  >
                    {item.favorite ? "Unstar" : "Star"}
                  </Button>
                  {item.type === "image" && (
                    <Button
                      variant="subtle"
                      size="compact-sm"
                      onClick={() =>
                        mutate.mutate({
                          path: "/api/upscale",
                          body: { galleryItemId: item.id, quality: "balanced" },
                        })
                      }
                    >
                      Upscale
                    </Button>
                  )}
                  {item.upscale?.url && (
                    <Button
                      variant="subtle"
                      size="compact-sm"
                      onClick={() => {
                        setCompare(!compare);
                      }}
                    >
                      {compare ? "Close Comparison" : "Compare"}
                    </Button>
                  )}
                  <Button
                    color="red"
                    variant="subtle"
                    size="compact-sm"
                    onClick={() => {
                      mutate.mutate({
                        path: `/api/gallery/${encodeURIComponent(item.id)}`,
                        method: "DELETE",
                      });
                      close();
                    }}
                  >
                    Delete
                  </Button>
                </Group>

                <Stack gap="sm">
                  <Title order={5}>Prompt</Title>
                  <Text style={{ whiteSpace: "pre-wrap" }}>{item.prompt}</Text>
                  {item.negative && (
                    <>
                      <Title order={5}>Negative Prompt</Title>
                      <Text>{item.negative}</Text>
                    </>
                  )}
                  <Title order={5}>Model & Settings</Title>
                  <Text size="sm">{item.model}</Text>
                  <Table.ScrollContainer minWidth={360}>
                    <Table aria-label="Generation Settings" verticalSpacing="xs">
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Setting</Table.Th>
                          <Table.Th>Value</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {Object.entries(item.settings || {})
                          .filter(([, value]) =>
                            ["string", "number", "boolean"].includes(typeof value),
                          )
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([key, value]) => (
                            <Table.Tr key={key}>
                              <Table.Td>
                                <Text size="sm" c="dimmed">
                                  {key}
                                </Text>
                              </Table.Td>
                              <Table.Td>
                                <Text size="sm" style={{ overflowWrap: "anywhere" }}>
                                  {String(value)}
                                </Text>
                              </Table.Td>
                            </Table.Tr>
                          ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                  <Text size="xs" c="dimmed">
                    {item.createdAt}
                  </Text>
                </Stack>
              </Stack>
            </Collapse>
          </Stack>
        </Paper>
      </div>
    </Modal>
  );
}
