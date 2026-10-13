import React from 'react';
import type { ReferenceAsset } from './types';

/** Square thumbnails share one measured stride; keep only visible rows and keyboard focus mounted. */
export function ReferenceGrid({ items, render }: { items: ReferenceAsset[]; render: (asset: ReferenceAsset, index: number, style: React.CSSProperties, tabIndex: number) => React.ReactNode }) {
  const grid = React.useRef<HTMLDivElement>(null);
  const pendingFocus = React.useRef<number | null>(null);
  const [focused, setFocused] = React.useState<number | null>(null);
  const [layout, setLayout] = React.useState({ columns: 3, size: 104, gap: 8, start: 0, end: 24 });
  const measure = React.useCallback(() => {
    const element = grid.current;
    const body = element?.closest<HTMLElement>('.reference-popover-body');
    if (!element || !body) return;
    const css = getComputedStyle(element);
    const columns = Math.max(1, css.gridTemplateColumns.split(' ').length);
    const gap = parseFloat(css.columnGap) || 0;
    const size = (element.clientWidth - gap * (columns - 1)) / columns;
    if (size <= 0) return;
    const top = Math.max(0, body.getBoundingClientRect().top - element.getBoundingClientRect().top);
    const start = Math.max(0, Math.floor(top / (size + gap)) - 2) * columns;
    const end = Math.min(items.length, (Math.ceil((top + body.clientHeight) / (size + gap)) + 2) * columns);
    setLayout((current) => current.columns === columns && current.size === size && current.gap === gap && current.start === start && current.end === end ? current : { columns, size, gap, start, end });
  }, [items.length]);
  React.useLayoutEffect(() => {
    const element = grid.current;
    const body = element?.closest<HTMLElement>('.reference-popover-body');
    if (!element || !body) return;
    let frame = 0;
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); }); };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(body);
    body.addEventListener('scroll', onScroll, { passive: true });
    measure();
    return () => { observer.disconnect(); body.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, [measure]);
  React.useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    const button = grid.current?.querySelector<HTMLButtonElement>(`[data-reference-index="${pendingFocus.current}"]`);
    if (button) { button.focus({ preventScroll: true }); pendingFocus.current = null; }
  }, [focused, layout]);

  const start = Math.min(layout.start, items.length);
  const end = Math.min(layout.end, items.length);
  const indices = Array.from({ length: Math.max(0, end - start) }, (_, offset) => start + offset);
  if (focused !== null && focused < items.length && !indices.includes(focused)) indices.push(focused);
  indices.sort((a, b) => a - b);
  const stride = layout.size + layout.gap;
  const tabStop = focused !== null && focused < items.length ? focused : start;
  return <div ref={grid} className="reference-grid is-virtual" data-reference-grid style={{ height: Math.max(0, Math.ceil(items.length / layout.columns) * stride - layout.gap) }}
    onFocusCapture={(event) => {
      const value = (event.target as HTMLElement).closest<HTMLElement>('[data-reference-index]')?.dataset.referenceIndex;
      if (value !== undefined) setFocused(Number(value));
    }}
    onKeyDown={(event) => {
      const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -layout.columns, ArrowDown: layout.columns };
      const value = (event.target as HTMLElement).closest<HTMLElement>('[data-reference-index]')?.dataset.referenceIndex;
      if (value === undefined || (!offsets[event.key] && event.key !== 'Home' && event.key !== 'End')) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, Number(value) + offsets[event.key]));
      pendingFocus.current = next;
      setFocused(next);
      const body = grid.current!.closest<HTMLElement>('.reference-popover-body')!;
      const top = grid.current!.getBoundingClientRect().top - body.getBoundingClientRect().top + Math.floor(next / layout.columns) * stride;
      if (top < 0) body.scrollTop += top;
      else if (top + layout.size > body.clientHeight) body.scrollTop += top + layout.size - body.clientHeight;
      measure();
    }}>
    {indices.map((index) => render(items[index], index, { position: 'absolute', top: Math.floor(index / layout.columns) * stride, left: (index % layout.columns) * stride, width: layout.size, height: layout.size }, index === tabStop ? 0 : -1))}
  </div>;
}
