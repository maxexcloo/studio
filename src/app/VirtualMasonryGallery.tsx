import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { GalleryTile } from './GalleryTile';
import type { GalleryItem } from './types';

type VirtualMasonryGalleryProps = {
  items: GalleryItem[];
  columns: number;
  scrollRef: React.RefObject<HTMLElement | null>;
  now: number;
  formatElapsed: (value: number) => string;
  titleFromPrompt: (value?: string) => string;
  openItem: (item: GalleryItem) => void;
  cancelJob: (jobId?: string) => void;
  copyImageAndToast: (item: GalleryItem) => void;
  deleteItem: (item: GalleryItem) => void;
};

function estimatedHeight(item: GalleryItem, width: number) {
  const ratio = Number(item.width || 1) / Math.max(1, Number(item.height || 1));
  return Math.max(120, Math.round(width / Math.max(0.2, ratio)));
}

function itemKey(item: GalleryItem) {
  return item.id || item.url || item.outputName || item.filename;
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    setWidth(ref.current.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function VirtualMasonryGallery({
  cancelJob,
  columns,
  copyImageAndToast,
  deleteItem,
  formatElapsed,
  items,
  now,
  openItem,
  scrollRef,
  titleFromPrompt,
}: VirtualMasonryGalleryProps) {
  const [containerRef, containerWidth] = useElementWidth<HTMLElement>();
  const safeColumns = Math.max(1, columns);
  const spacing = containerWidth < 620 ? 4 : 7;
  const columnWidth = containerWidth ? Math.floor((containerWidth - spacing * (safeColumns - 1)) / safeColumns) : 240;
  const columnItems = useMemo(() => {
    const next = Array.from({ length: safeColumns }, () => ({ height: 0, items: [] as GalleryItem[] }));
    for (const item of items) {
      let target = 0;
      for (let index = 1; index < next.length; index += 1) {
        if (next[index].height < next[target].height) target = index;
      }
      next[target].items.push(item);
      next[target].height += estimatedHeight(item, columnWidth) + spacing;
    }
    return next.map((column) => column.items);
  }, [columnWidth, items, safeColumns, spacing]);

  return (
    <section
      ref={containerRef}
      className="gallery virtual-gallery"
      style={{ "--gallery-columns": safeColumns, "--gallery-gap": `${spacing}px` } as React.CSSProperties}
    >
      {columnItems.map((column, index) => (
        <VirtualMasonryColumn
          key={`virtual-column-${index}`}
          cancelJob={cancelJob}
          column={column}
          copyImageAndToast={copyImageAndToast}
          deleteItem={deleteItem}
          formatElapsed={formatElapsed}
          now={now}
          openItem={openItem}
          scrollRef={scrollRef}
          spacing={spacing}
          titleFromPrompt={titleFromPrompt}
          width={columnWidth}
        />
      ))}
    </section>
  );
}

function VirtualMasonryColumn({
  cancelJob,
  column,
  copyImageAndToast,
  deleteItem,
  formatElapsed,
  now,
  openItem,
  scrollRef,
  spacing,
  titleFromPrompt,
  width,
}: Omit<VirtualMasonryGalleryProps, "columns" | "items"> & { column: GalleryItem[]; spacing: number; width: number }) {
  const virtualizer = useVirtualizer({
    count: column.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimatedHeight(column[index], width) + spacing,
    overscan: 8,
    getItemKey: (index) => itemKey(column[index]) || index,
  });
  return (
    <div className="gallery-column virtual-gallery-column" style={{ width }}>
      <div className="virtual-gallery-spacer" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const item = column[virtualItem.index];
          if (!item) return null;
          const height = estimatedHeight(item, width);
          const cellHeight = height + spacing;
          return (
            <div
              key={virtualItem.key}
              ref={virtualizer.measureElement}
              className="virtual-gallery-cell"
              data-index={virtualItem.index}
              style={{ height: cellHeight, transform: `translateY(${virtualItem.start}px)` }}
            >
              <GalleryTile
                cancelJob={cancelJob}
                copyImageAndToast={copyImageAndToast}
                deleteItem={deleteItem}
                formatElapsed={formatElapsed}
                height={height}
                item={item}
                now={now}
                openItem={openItem}
                titleFromPrompt={titleFromPrompt}
                width={width}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
