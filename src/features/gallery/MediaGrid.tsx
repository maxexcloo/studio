import { useLayoutEffect, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useMediaQuery } from "@mantine/hooks";
import { Badge, Group, Text } from "@mantine/core";
import type { MediaItem } from "../../types";
import { galleryReferenceType } from "../generation/references";
export function MediaGrid({
  items,
  open,
}: {
  items: MediaItem[];
  open: (item: MediaItem) => void;
}) {
  const phone = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const compact = useMediaQuery("(max-width: 75em)", false, { getInitialValueInEffect: false });
  const columns = phone ? 2 : compact ? 3 : 5;
  const host = useRef<HTMLDivElement>(null),
    [width, setWidth] = useState(0);
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
          <button
            key={item.id}
            className="studio-media-button"
            style={{
              position: "absolute",
              top: 0,
              left: placement.lane * (columnWidth + gap),
              width: columnWidth,
              height: placement.size,
              transform: `translateY(${placement.start - virtual.options.scrollMargin}px)`,
            }}
            aria-label={`Open ${item.type}: ${item.prompt || item.filename || "Result"}`}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "copy";
              event.dataTransfer.setData(
                galleryReferenceType,
                JSON.stringify({ id: item.id, type: item.type }),
              );
            }}
            onClick={() => open(item)}
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
          </button>
        );
      })}
    </div>
  );
}
