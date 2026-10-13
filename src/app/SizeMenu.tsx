import React from 'react';
import { Check, Link2, Pencil, Trash2, Unlink2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { aspectIconStyle, cn } from './format';
import { Tip } from './components';
import { fitRatio, megapixels, parseSize, presetRatio, ratioName, sameRatio, snapSide, type SideLimits, type Size } from './sizing';
import { sizePlan } from './useUpscale';
import type { AspectPreset, NativeSupport, SavedSize } from './types';

/* ---------------------------------------------------------------------------
   The size menu's parts (components.tsx AspectPicker puts them together):

   - SizePreview: a window of its own beside the menu, there from the first
     hover until the menu closes, with the frame the picture will fill gliding between shapes:
     the size chosen, or the row under the pointer while one is.
   - SizeTabs: Default · 2K · Custom, one sliding thumb.
   - LinkedSizeFields: Custom's width and height. Linked they read as one
     field and keep the shape; the link in the middle splits them. Each takes
     typing, arrow keys, or a drag on its W/H label, like a design tool.
--------------------------------------------------------------------------- */

export type SizeTier = "none" | "2k" | "custom";

export type SizeRow = { key: string; value: string; label: string; small?: string; shape: AspectPreset; size: Size };

/**
 * What the size menu shows, worked out once for the desktop menu and the
 * phone's size sheet: the rows and the size each makes on this tab, which
 * one is chosen, and how the choice reads (label, tag, caption, note).
 *
 * Default and 2K use the model's preset shapes, 2K drawn with the long side
 * at 2048. Custom is any width and height; a shape row there keeps the area
 * and changes the shape.
 */
export function sizeMenuModel({ value, options, currentSize, defaultSize, tier, native = {}, sizeMax = 8192, limits, savedSizes = [] }: {
  value: string;
  options: AspectPreset[];
  currentSize: string;
  defaultSize: string;
  tier: SizeTier;
  native?: NativeSupport;
  sizeMax?: number;
  limits?: { width: SideLimits; height: SideLimits };
  savedSizes?: SavedSize[];
}) {
  const custom = tier === "custom";
  const picked = parseSize(currentSize);
  const plan = sizePlan(tier === "2k" ? "2k" : "none", picked.width, picked.height, native, sizeMax);
  const shown = custom ? picked : plan.final;
  const selected = options.find((item) => item.value === value);
  const isDefault = value === "default";
  // The ratio the default size already is: one row ("Default 1:1"), not two with the same size.
  const defaultOption = options.find((item) => item.value === defaultSize);
  const listed = defaultOption ? options.filter((item) => item !== defaultOption) : options;
  const defaultShape = parseSize(defaultSize);
  const area = picked.width * picked.height;
  // What each row makes on this tab: the preset, the preset at 2K, or its shape at Custom's area.
  const rowSize = (shape: AspectPreset) => custom && limits
    ? fitRatio(presetRatio(shape), area, limits.width, limits.height, 16)
    : tier === "2k" ? sizePlan("2k", shape.w, shape.h, native, sizeMax).final : { width: shape.w, height: shape.h };
  const defaultPreset: AspectPreset = defaultOption || { label: ratioName(defaultShape.width, defaultShape.height), value: defaultSize, w: defaultShape.width, h: defaultShape.height };
  const rows: SizeRow[] = [
    { key: "default", value: "default", label: "Default", small: defaultPreset.label, shape: defaultPreset, size: rowSize(defaultPreset) },
    ...listed.map((option) => ({ key: option.value, value: option.value, label: option.label, shape: option, size: rowSize(option) }))
  ];
  // In Custom a saved size that is exactly this one is the pick, rather than the shape it shares.
  const savedMatch = custom ? savedSizes.find((item) => item.width === picked.width && item.height === picked.height) : undefined;
  const isActive = (row: SizeRow) => custom ? !savedMatch && sameRatio(row.size, shown) : row.value === value;
  // "Save size" is for a shape of your own: one no preset row has (within 0.5%), not a preset made bigger or smaller.
  const ownShape = custom && !rows.some((row) => Math.abs(picked.width / picked.height / presetRatio(row.shape) - 1) <= 0.005);
  const savedRow = (item: SavedSize): SizeRow => ({ key: item.id, value: "", label: item.name, small: ratioName(item.width, item.height), shape: { label: "", value: "", w: item.width, h: item.height }, size: { width: item.width, height: item.height } });
  const ratio = ratioName(shown.width, shown.height);
  const label = custom ? ratio : selected ? selected.label : isDefault ? "Default" : ratio;
  const badge = tier === "2k" ? "2K" : custom ? "C" : "";
  const what = `${label}, ${shown.width} × ${shown.height}${tier === "2k" ? ", 2K" : custom ? ", custom size" : ""}`;
  /** The preview's caption for a row, or for the size chosen: "Name · ratio" where the name isn't the ratio itself. */
  const captionFor = (row: SizeRow | null) => row
    ? (row.small ? `${row.label} · ${row.small}` : row.label)
    : custom ? `${savedMatch ? savedMatch.name : "Custom"} · ${ratio}` : isDefault ? `Default · ${defaultOption?.label || ratio}` : label;
  const note = tier === "2k" && plan.capped ? `This model goes up to ${sizeMax} px a side.`
    : tier === "2k" && plan.untested ? "This model isn’t known for 2K. Some pictures may repeat or warp."
    : "";
  return { custom, picked, shown, rows, savedMatch, ownShape, isActive, savedRow, label, badge, what, captionFor, note };
}

const tierLabels: Record<SizeTier, string> = { none: "Default", "2k": "2K", custom: "Custom" };

/**
 * The frame on its own window beside the menu. The window is the stage: the
 * frame sits in it at the shape it stands for, and lines from its edges run
 * across the whole window, so a change of shape reads as the lines sliding.
 * The window's size comes from the menu it sits beside, so it is measured.
 */
export function SizePreview({ size, label, sub, accent = false, shown = true, inset = 26, className }: {
  size: Size;
  label: string;
  sub: string;
  accent?: boolean;
  shown?: boolean;
  /** The frame's margin inside the window: the phone's shorter stage keeps less. */
  inset?: number;
  className?: string;
}) {
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
    <div ref={ref} className={cn("size-peek", className, shown && "is-on", accent && "is-accent", stage.width > 0 && "is-measured")} aria-hidden="true">
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
export function LinkedSizeFields({ size, limits, onChange, onSave, saved = false }: {
  size: Size;
  limits: { width: SideLimits; height: SideLimits };
  onChange: (size: Size) => void;
  /** "Save size": keep this size in the menu's list. Left out where there's no list to keep it in. */
  onSave?: () => void;
  /** This exact size is saved already. */
  saved?: boolean;
}) {
  const [linked, setLinked] = React.useState(true);
  // Just clicked: the hover lean waits until the pointer leaves the link, so the click's move plays in full.
  const [fresh, setFresh] = React.useState(false);
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
      <div className={cn("size-fields", linked && "is-linked", fresh && "is-fresh")}>
        <SizeField axis="W" value={size.width} limits={limits.width} onStart={begin} onChange={setWidth} />
        <Tip content={linked ? "Linked: the shape stays as you resize. Click to unlink" : "Unlinked: width and height change on their own. Click to link"}>
          <button type="button" className="size-link" aria-pressed={linked} aria-label={linked ? "Unlink width and height" : "Link width and height"} onClick={() => { begin(); setFresh(true); setLinked((value) => !value); }} onPointerLeave={() => setFresh(false)}>
            {/* Keyed, so each change plays the icon's turn (37-size-menu.css). */}
            <span key={linked ? "linked" : "apart"} className="size-link-icon">{linked ? <Link2 size={14} strokeWidth={2.2} /> : <Unlink2 size={14} strokeWidth={2.2} />}</span>
          </button>
        </Tip>
        <SizeField axis="H" value={size.height} limits={limits.height} onStart={begin} onChange={setHeight} />
      </div>
      <div className="size-custom-note">
        <span>{megapixels(size)} · {ratioName(size.width, size.height)}{atLimit ? <span className="is-limit"> · up to {Math.min(maxW, maxH)} px</span> : null}</span>
        {onSave ? (
          <button type="button" className={cn("size-save", saved && "is-saved")} disabled={saved} onClick={onSave}>
            {/* Keyed, so the word changes with a small lift rather than a jump. */}
            <span key={saved ? "saved" : "save"}>{saved ? <><Check size={12} strokeWidth={2.6} /> Saved</> : "Save size"}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A saved size in the shape list. It reads like any other row: its name with
 * its ratio beside it, its size on the right. Hovered (or focused), the size
 * steps left for Rename and Remove; renaming edits the name in place, Enter
 * or leaving keeps it, Escape puts it back without closing the menu.
 */
export function SavedSizeRow({ saved, active, onPick, onRename, onRemove, onPreview }: {
  saved: SavedSize;
  active: boolean;
  onPick: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
  /** The row is under the pointer or focused (true), or not any more (false). */
  onPreview: (on: boolean) => void;
}) {
  const [renaming, setRenaming] = React.useState(false);
  const [draft, setDraft] = React.useState(saved.name);
  const ratio = ratioName(saved.width, saved.height);
  const shape = { label: ratio, value: `${saved.width}x${saved.height}`, w: saved.width, h: saved.height };
  const finish = (keep: boolean) => {
    const name = draft.trim();
    if (keep && name && name !== saved.name) onRename(name);
    setRenaming(false);
  };
  return (
    <motion.div
      className="size-saved"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className={cn("size-saved-row", renaming && "is-renaming")} onPointerEnter={(event) => { if (event.pointerType !== "touch") onPreview(true); }}>
        {renaming ? (
          <div className={cn("aspect-option is-saved", active && "active")}>
            <span className="aspect-shape" style={aspectIconStyle(shape)} />
            <input
              className="size-saved-name"
              data-own-escape
              autoFocus
              value={draft}
              maxLength={32}
              aria-label="Name of this size"
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => finish(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); finish(true); }
                if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false); }
              }}
            />
            <em>{saved.width}×{saved.height}</em>
          </div>
        ) : (
          <button
            type="button"
            className={cn("aspect-option is-saved", active && "active")}
            role="option"
            aria-selected={active}
            onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) onPreview(true); }}
            onBlur={() => onPreview(false)}
            onClick={onPick}
          >
            <span className="aspect-shape" style={aspectIconStyle(shape)} />
            <span>{saved.name}<small>{ratio}</small></span>
            <em>{saved.width}×{saved.height}</em>
          </button>
        )}
        {renaming ? null : (
          <span className="size-saved-actions">
            <Tip content="Rename"><button type="button" aria-label={`Rename ${saved.name}`} onClick={() => { setDraft(saved.name); setRenaming(true); }}><Pencil size={13} /></button></Tip>
            <Tip content="Remove"><button type="button" className="is-remove" aria-label={`Remove ${saved.name}`} onClick={onRemove}><Trash2 size={13} /></button></Tip>
          </span>
        )}
      </div>
    </motion.div>
  );
}
