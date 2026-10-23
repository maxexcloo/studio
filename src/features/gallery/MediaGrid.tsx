import { useLayoutEffect, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useMediaQuery } from "@mantine/hooks";
import { Badge, Box, Checkbox, Group, Text, UnstyledButton } from "@mantine/core";
import type { MediaItem } from "../../types";
import { galleryReferenceType } from "../generation/references";
import type { GallerySelection } from "./useGallerySelection";
export function MediaGrid({
  items,
  open,
  selection,
}: {
  items: MediaItem[];
  open: (item: MediaItem) => void;
  selection?: GallerySelection;
}) {
  const phone = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const compact = useMediaQuery("(max-width: 75em)", false, { getInitialValueInEffect: false });
  const columns = phone ? 2 : compact ? 3 : 5;
  const host = useRef<HTMLDivElement>(null),
    [width, setWidth] = useState(0);
  const pendingFocus = useRef<string | null>(null);
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
    overscan: columns * 2,
    scrollMargin: host.current?.offsetTop || 0,
  });
  useLayoutEffect(() => virtual.measure(), [width, columns, dimensions, virtual]);
  return (
    <div ref={host} style={{ height: virtual.getTotalSize(), position: "relative" }}>
      {virtual.getVirtualItems().map((placement) => {
        const item = items[placement.index],
          source = item.thumbnailUrl || item.preview || item.url;
        return (
          <Box
            key={item.id}
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
                  src={item.url || undefined}
                  poster={item.thumbnailUrl}
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
                  width={item.width || 1024}
                  height={item.height || 1024}
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
