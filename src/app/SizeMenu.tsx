import React from 'react';
import { Link2, Unlink2 } from 'lucide-react';
import { cn } from './format';
import { Tip } from './components';
import { megapixels, ratioName, snapSide, type SideLimits, type Size } from './sizing';

/* ---------------------------------------------------------------------------
   The size menu's parts (components.tsx AspectPicker puts them together):

   - SizePreview: a window of its own beside the menu, shown while the menu
     is hovered, with the frame the picture will fill gliding between shapes:
     the size chosen, or the row under the pointer while one is.
   - SizeTabs: Default · 2K · Custom, one sliding thumb.
   - LinkedSizeFields: Custom's width and height. Linked they read as one
     field and keep the shape; the link in the middle splits them. Each takes
     typing, arrow keys, or a drag on its W/H label, like a design tool.
--------------------------------------------------------------------------- */

export type SizeTier = "none" | "2k" | "custom";

const tierLabels: Record<SizeTier, string> = { none: "Default", "2k": "2K", custom: "Custom" };

/**
 * The frame on its own window beside the menu. The window is the stage: the
 * frame sits in it at the shape it stands for, and lines from its edges run
 * across the whole window, so a change of shape reads as the lines sliding.
 * The window's size comes from the menu it sits beside, so it is measured.
 */
export function SizePreview({ size, label, sub, accent = false, shown = true }: { size: Size; label: string; sub: string; accent?: boolean; shown?: boolean }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [stage, setStage] = React.useState({ width: 0, height: 0 });
  React.useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setStage({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  // Room for the frame: an inset all round, and the caption's line at the bottom.
  const inset = 26;
  const caption = 30;
  const roomW = Math.max(1, stage.width - inset * 2);
  const roomH = Math.max(1, stage.height - inset * 2 - caption);
  const scale = Math.min(roomW / Math.max(1, size.width), roomH / Math.max(1, size.height));
  const width = Math.max(3, size.width * scale);
  const height = Math.max(3, size.height * scale);
  const left = (stage.width - width) / 2;
  const top = inset + (roomH - height) / 2;
  const px = (value: number) => `${Math.round(value * 10) / 10}px`;
  return (
    <div ref={ref} className={cn("size-peek", shown && "is-on", accent && "is-accent", stage.width > 0 && "is-measured")} aria-hidden="true">
      {/* Lines from the frame's edges across the window: they glide with it. */}
      <i className="size-guide is-x" style={{ top: px(top) }} />
      <i className="size-guide is-x" style={{ top: px(top + height) }} />
      <i className="size-guide is-y" style={{ left: px(left) }} />
      <i className="size-guide is-y" style={{ left: px(left + width) }} />
      <div className="size-frame" style={{ left: px(left), top: px(top), width: px(width), height: px(height) }} />
      <p className="size-peek-caption"><strong>{label}</strong><span>{sub}</span></p>
    </div>
  );
}

export function SizeTabs({ tiers, value, onChange }: { tiers: SizeTier[]; value: SizeTier; onChange: (tier: SizeTier) => void }) {
  const index = Math.max(0, tiers.indexOf(value));
  return (
    <div className="aspect-upscale-tabs" role="radiogroup" aria-label="Size" style={{ "--tab-index": index, "--tab-count": tiers.length } as React.CSSProperties} onKeyDown={(event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      const next = tiers[(index + (event.key === "ArrowRight" ? 1 : -1) + tiers.length) % tiers.length];
      onChange(next);
      requestAnimationFrame(() => event.currentTarget.querySelector<HTMLButtonElement>(`[data-tier="${next}"]`)?.focus());
    }}>
      <i aria-hidden="true" />
      {tiers.map((tier) => (
        <button
          key={tier}
          type="button"
          role="radio"
          data-tier={tier}
          aria-checked={tier === value}
          tabIndex={tier === value ? 0 : -1}
          className={cn(tier === value && "is-active")}
          onClick={() => onChange(tier)}
        >{tierLabels[tier]}</button>
      ))}
    </div>
  );
}

/** One side's field: type, arrow keys, or drag its label sideways. */
function SizeField({ axis, value, limits, onStart, onChange }: {
  axis: "W" | "H";
  value: number;
  limits: SideLimits;
  /** A change begins (focus, a drag): the linked shape is taken from here. */
  onStart: () => void;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = React.useState(String(value));
  const [editing, setEditing] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  React.useEffect(() => { if (!editing) setDraft(String(value)); }, [value, editing]);
  const step = limits.step || 16;
  const snap = (next: number) => snapSide(next, limits, step);
  const commit = () => {
    const typed = Number(draft);
    const next = typed > 0 ? snap(typed) : value;
    if (next !== value) onChange(next);
    setDraft(String(next));
  };

  const drag = React.useRef<{ x: number; value: number } | null>(null);
  const onPointerDown = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, value };
    onStart();
    setDragging(true);
    document.documentElement.classList.add("is-size-scrubbing");
  };
  const onPointerMove = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (!drag.current) return;
    // One step every 3px; Shift moves four times as fast.
    const steps = Math.round((event.clientX - drag.current.x) / 3) * (event.shiftKey ? 4 : 1);
    const next = snap(drag.current.value + steps * step);
    if (next !== value) onChange(next);
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
    document.documentElement.classList.remove("is-size-scrubbing");
  };

  const label = axis === "W" ? "Width" : "Height";
  return (
    <label className={cn("size-field", dragging && "is-dragging")}>
      <Tip content={`Drag to change the ${label.toLowerCase()}`}>
        <span className="size-field-key" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} aria-hidden="true">{axis}</span>
      </Tip>
      <input
        inputMode="numeric"
        aria-label={`${label} in pixels`}
        value={draft}
        onFocus={(event) => { setEditing(true); onStart(); event.currentTarget.select(); }}
        onBlur={() => { setEditing(false); commit(); }}
        onChange={(event) => {
          const digits = event.target.value.replace(/[^0-9]/g, "").slice(0, 5);
          setDraft(digits);
          // The frame follows the typing; the value settles on its step when you're done.
          const typed = Number(digits);
          if (typed >= (limits.min ?? 64) && typed <= (limits.max ?? 4096)) onChange(snap(typed));
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); commit(); event.currentTarget.select(); }
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            onStart();
            const next = snap(value + (event.key === "ArrowUp" ? 1 : -1) * step * (event.shiftKey ? 10 : 1));
            setDraft(String(next));
            if (next !== value) onChange(next);
          }
        }}
      />
    </label>
  );
}

/**
 * Custom's width and height. Linked, a change to one carries the other along
 * at the shape it had when the change began (so snapping never drifts it);
 * a side that would pass its limit holds the pair at the limit instead.
 */
export function LinkedSizeFields({ size, limits, onChange }: { size: Size; limits: { width: SideLimits; height: SideLimits }; onChange: (size: Size) => void }) {
  const [linked, setLinked] = React.useState(true);
  const shape = React.useRef(size.width / size.height);
  const begin = () => { shape.current = size.width / size.height; };
  const maxW = limits.width.max ?? 4096;
  const maxH = limits.height.max ?? 4096;
  const setWidth = (width: number) => {
    if (!linked) return onChange({ width, height: size.height });
    let height = snapSide(width / shape.current, limits.height);
    if (width / shape.current > maxH) { height = maxH; width = snapSide(maxH * shape.current, limits.width); }
    onChange({ width, height });
  };
  const setHeight = (height: number) => {
    if (!linked) return onChange({ width: size.width, height });
    let width = snapSide(height * shape.current, limits.width);
    if (height * shape.current > maxW) { width = maxW; height = snapSide(maxW / shape.current, limits.height); }
    onChange({ width, height });
  };
  const atLimit = size.width >= maxW || size.height >= maxH;
  return (
    <div className="size-custom-body">
      <div className={cn("size-fields", linked && "is-linked")}>
        <SizeField axis="W" value={size.width} limits={limits.width} onStart={begin} onChange={setWidth} />
        <Tip content={linked ? "Linked: the shape stays as you resize. Click to unlink" : "Unlinked: width and height change on their own. Click to link"}>
          <button type="button" className="size-link" aria-pressed={linked} aria-label={linked ? "Unlink width and height" : "Link width and height"} onClick={() => { begin(); setLinked((value) => !value); }}>
            {linked ? <Link2 size={14} strokeWidth={2.2} /> : <Unlink2 size={14} strokeWidth={2.2} />}
          </button>
        </Tip>
        <SizeField axis="H" value={size.height} limits={limits.height} onStart={begin} onChange={setHeight} />
      </div>
      <p className="size-custom-note">
        <span>{megapixels(size)} · {ratioName(size.width, size.height)}</span>
        {atLimit ? <span className="is-limit">Up to {Math.min(maxW, maxH)} px a side</span> : null}
      </p>
    </div>
  );
}
