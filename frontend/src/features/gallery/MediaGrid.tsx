import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useLongPress, useMediaQuery } from "@mantine/hooks";
import { Badge, Box, Checkbox, Group, Text, UnstyledButton } from "@mantine/core";
import type { MediaItem } from "../../types";
import { galleryReferenceType } from "../generation/references";
import type { GallerySelection } from "./useGallerySelection";
import { mediaSource } from "./mediaSource";
export function MediaGrid({
  items,
  open,
  selection,
  focusItem,
  renderActions,
}: {
  items: MediaItem[];
  open: (item: MediaItem) => void;
  selection?: GallerySelection;
  focusItem?: string | null;
  renderActions?: (
    item: MediaItem,
    opened: boolean,
    onOpenedChange: (opened: boolean) => void,
  ) => ReactNode;
}) {
  const phone = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const compact = useMediaQuery("(max-width: 75em)", false, { getInitialValueInEffect: false });
  const columns = phone ? 2 : compact ? 3 : 5;
  const host = useRef<HTMLDivElement>(null),
    [width, setWidth] = useState(0);
  const pendingFocus = useRef<string | null>(null);
  const [contextItemId, setContextItemId] = useState<string | null>(null);
  const heldItem = useRef<string | null>(null);
  const longPress = useLongPress(
    (event) => {
      if (!phone || !selection) return;
      const id = (event.target as Element).closest<HTMLElement>("[data-media-id]")?.dataset.mediaId;
      const item = items.find((item) => item.id === id);
      if (!item || !["done", "error"].includes(item.status)) return;
      heldItem.current = item.id;
      setContextItemId(null);
      selection.toggle(item);
    },
    {
      events: ["touch"],
      cancelOnMove: true,
      onStart: () => {
        heldItem.current = null;
      },
    },
  );
  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    const button = host.current?.querySelector<HTMLButtonElement>(
      `[data-media-id="${CSS.escape(pendingFocus.current)}"]`,
    );
    if (button) {
      button.focus({ preventScroll: true });
      button.scrollIntoView({ block: "nearest" });
      pendingFocus.current = null;
    }
  });
  useLayoutEffect(() => {
    const element = host.current!;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const gap = 8,
    columnWidth = (width - gap * (columns - 1)) / columns,
    dimensions = items.map((item) => `${item.id}:${item.width}:${item.height}`).join("|");
  const virtual = useWindowVirtualizer({
    count: width ? items.length : 0,
    lanes: columns,
    gap,
    estimateSize: (index) =>
      (columnWidth * (items[index].height || 1024)) / (items[index].width || 1024),
    getItemKey: (index) => items[index].id,
    overscan: 2,
    scrollMargin: host.current?.offsetTop || 0,
  });
  useLayoutEffect(() => virtual.measure(), [width, columns, dimensions, virtual]);
  useLayoutEffect(() => {
    if (!focusItem || !width) return;
    const index = items.findIndex((item) => item.id === focusItem);
    if (index < 0) return;
    pendingFocus.current = focusItem;
    virtual.scrollToIndex(index, { align: "auto" });
    const button = host.current?.querySelector<HTMLButtonElement>(
      `[data-media-id="${CSS.escape(focusItem)}"]`,
    );
    if (button) {
      button.focus({ preventScroll: true });
      button.scrollIntoView({ block: "nearest" });
      pendingFocus.current = null;
    }
  }, [focusItem, width, virtual]);
  return (
    <div ref={host} {...longPress} style={{ height: virtual.getTotalSize(), position: "relative" }}>
      {virtual.getVirtualItems().map((placement) => {
        const item = items[placement.index],
          media = mediaSource(item),
          source = media.thumbnailUrl || item.preview || media.url;
        return (
          <Box
            key={item.id}
            className="studio-media-tile"
            onContextMenu={(event) => {
              if (heldItem.current === item.id) {
                event.preventDefault();
                return;
              }
              if (!renderActions || selection?.selecting) return;
              event.preventDefault();
              setContextItemId(item.id);
            }}
            style={{
              position: "absolute",
              top: 0,
              left: placement.lane * (columnWidth + gap),
              width: columnWidth,
              height: placement.size,
              transform: `translateY(${placement.start - virtual.options.scrollMargin}px)`,
              outline: selection?.selected.has(item.id)
                ? "2px solid var(--mantine-primary-color-filled)"
                : undefined,
              outlineOffset: 2,
            }}
          >
            <UnstyledButton
              className="studio-media-button"
              w="100%"
              h="100%"
              data-media-id={item.id}
              aria-label={`${selection?.selecting ? "Select" : "Open"} ${item.type}: ${item.prompt || item.filename || "Result"}`}
              aria-pressed={selection?.selecting ? selection.selected.has(item.id) : undefined}
              draggable
              onKeyDown={(event) => {
                if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
                const direction =
                  event.key === "ArrowLeft" || event.key === "ArrowUp"
                    ? -1
                    : event.key === "ArrowRight" || event.key === "ArrowDown"
                      ? 1
                      : 0;
                if (!direction) return;
                const index = placement.index + direction;
                if (!items[index]) return;
                event.preventDefault();
                pendingFocus.current = items[index].id;
                virtual.scrollToIndex(index, { align: "auto" });
                // Mounted neighbours can receive focus without waiting for a scroll render.
                const next = host.current?.querySelector<HTMLButtonElement>(
                  `[data-media-id="${CSS.escape(items[index].id)}"]`,
                );
                if (next) {
                  next.focus({ preventScroll: true });
                  next.scrollIntoView({ block: "nearest" });
                  pendingFocus.current = null;
                }
              }}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData(
                  galleryReferenceType,
                  JSON.stringify({ id: item.id, type: item.type }),
                );
              }}
              onClick={(event) => {
                if (heldItem.current === item.id) {
                  heldItem.current = null;
                  event.preventDefault();
                  return;
                }
                if (selection?.click(item, event)) return;
                event.currentTarget.focus({ preventScroll: true });
                open(item);
              }}
            >
              {!source ? (
                <div className="studio-preview" />
              ) : item.type === "video" ? (
                <video
                  className="studio-preview"
                  src={media.url || undefined}
                  poster={media.thumbnailUrl}
                  preload="none"
                  muted
                  playsInline
                  aria-label={item.prompt || "Generated Video"}
                />
              ) : (
                <img
                  key={source}
                  className="studio-preview"
                  src={source}
                  alt={item.prompt || "Generated Image"}
                  width={media.width || 1024}
                  height={media.height || 1024}
                  loading="lazy"
                  draggable={false}
                  onError={(event) => {
                    event.currentTarget.style.visibility = "hidden";
                  }}
                />
              )}
              {item.status !== "done" && (
                <Badge
                  className="studio-media-status"
                  color={item.status === "error" ? "red" : "gray"}
                >
                  {item.status}
                </Badge>
              )}
              <div className="studio-media-caption">
                <Text lineClamp={2} size="sm">
                  {item.prompt || item.filename || "Untitled Result"}
                </Text>
                <Group gap="xs">
                  <Text size="xs">
                    {item.type === "image" ? "Image" : "Video"}
                    {item.width ? ` · ${item.width} × ${item.height}` : ""}
                  </Text>
                  {item.favorite && <Badge size="xs">Starred</Badge>}
                </Group>
              </div>
            </UnstyledButton>
            {!selection?.selecting &&
              renderActions?.(item, contextItemId === item.id, (opened) =>
                setContextItemId(opened ? item.id : null),
              )}
            {selection?.selecting && (item.status === "done" || item.status === "error") && (
              <Checkbox
                pos="absolute"
                top={8}
                right={8}
                checked={selection.selected.has(item.id)}
                aria-label={`Select ${item.prompt || item.filename || "Result"}`}
                onChange={() => selection.toggle(item)}
                styles={{ root: { zIndex: 2 } }}
              />
            )}
          </Box>
        );
      })}
    </div>
  );
}
