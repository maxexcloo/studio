import React, { useEffect, useRef } from 'react';
import { Check, Loader2, MoreHorizontal, Square } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { tweens } from "@/lib/springs";
import { cn } from './format';
import { Tip } from './components';
import { GenerationMedia } from './GenerationPreview';
import { GenerationModel, GenerationProfiles, GenerationProgress } from './GenerationProgress';
import { FailureTile } from './GenerationFailure';
import type { GalleryItem, Profile } from './types';
import { canUpscaleItem, upscaleTooltip, useUpscaleClock } from './useUpscale';
import { UpscaleArrow } from './UpscaleArrow';
import { GallerySelectionContext } from './gallerySelection';
import { downloadName } from './share';
import { useItemActions, type ItemAction } from './itemActions';
import { ActionIcon, startsGroup } from './ItemActionSurfaces';
import { itemProfileTitle } from './itemProfile';

/**
 * The phone studio's tiles: nothing over the picture but its state (progress,
 * a failure, a selection check); a long press starts selecting. `captions`
 * (Settings › Studio › Gallery › Tile Captions) brings back the prompt and name.
 * Null everywhere else.
 */
export type PhoneTiles = {
  onLongPress: (item: GalleryItem) => void;
  captions?: boolean;
};
export const TileLongPressContext = React.createContext<PhoneTiles | null>(null);

/** A desktop caption's second line: when it was made · the profile's friendly name (· a video's length). */
function tileCaptionDetail(item: GalleryItem, profiles: Profile[]) {
  const made = item.createdAt ? new Date(item.createdAt) : null;
  const time = made && !Number.isNaN(made.getTime()) ? made.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  const duration = item.type === 'video' && item.settings?.duration ? `${item.settings.duration} s` : '';
  return [time, itemProfileTitle(item, profiles), duration].filter(Boolean).join(' · ');
}

/* A tile's top row: 32px glass circles on a 40px pitch, right-aligned, clear of
   the upscale corner on the left. When the tile is too narrow for every action,
   the make group goes first, then keep; Star and Delete stay longest, and More
   (the right-click menu) takes the last slot. */
const TILE_SLOT = 40;
const TILE_ROW_RESERVE = 16 + 40 + 8;
const rowRank = { organise: 3, keep: 2, make: 1 } as const;
export function tileRow(actions: ItemAction[], width: number) {
  const slots = Math.max(1, Math.floor((width - TILE_ROW_RESERVE) / TILE_SLOT));
  if (actions.length <= slots) return { shown: actions, more: false };
  const keep = new Set([...actions.keys()].sort((a, b) => rowRank[actions[b].group] - rowRank[actions[a].group] || a - b).slice(0, Math.max(0, slots - 1)));
  return { shown: actions.filter((_, index) => keep.has(index)), more: true };
}

type GalleryTileProps = {
  item: GalleryItem;
  width: number;
  height: number;
  formatElapsed: (value: number) => string;
  titleFromPrompt: (value?: string) => string;
  openItem: (item: GalleryItem) => void;
  cancelJob: (jobId?: string) => void;
  smartUpscale?: boolean;
  upscaleBusy?: boolean;
  onUpscale?: (item: GalleryItem) => void;
  onCancelUpscale?: (item: GalleryItem) => void;
};

function UpscaleButton({ item, busy, onUpscale, onCancelUpscale }: { item: GalleryItem; busy: boolean; onUpscale: (item: GalleryItem) => void; onCancelUpscale: (item: GalleryItem) => void }) {
  const state = item.upscale;
  const running = state?.status === "running";
  // The ring follows the learned time when there is one; SeedVR2's own count jumps in a few big steps.
  const clock = useUpscaleClock(item);
  const stepRatio = state?.progress?.max ? Math.min(1, Math.max(0, state.progress.value / state.progress.max)) : 0;
  const ratio = clock.ratio ?? (clock.leftMs !== null ? 0 : stepRatio);
  const active = Boolean(item.upscaleActive && state?.url);
  const tooltip = upscaleTooltip(item, clock.leftMs);
  return (
    <Tip content={tooltip}>
      <button
        type="button"
        className={cn("tile-upscale", active && "is-active", running && "is-running", running && !ratio && "is-indeterminate", running && clock.ratio !== null && "is-timed", busy && "is-busy")}
        aria-label={tooltip}
        aria-pressed={state?.url ? active : undefined}
        aria-disabled={busy}
        onClick={() => { if (!busy) (running ? onCancelUpscale(item) : onUpscale(item)); }}
      >
        {busy ? <Loader2 size={14} className="spin" /> : running ? <Square size={10} fill="currentColor" strokeWidth={0} /> : <UpscaleArrow size={16} />}
        {running ? (
          // A stroked circle, not a masked gradient: hard gradient stops are not anti-aliased and read as jagged.
          <svg className="tile-upscale-ring" viewBox="0 0 30 30" aria-hidden="true" focusable="false">
            <circle cx="15" cy="15" r="14" pathLength={100} strokeDasharray={ratio ? `${ratio * 100} 100` : "25 75"} />
          </svg>
        ) : null}
      </button>
    </Tip>
  );
}

function GalleryTileComponent({ cancelJob, formatElapsed, height, item, onUpscale, onCancelUpscale = () => {}, openItem, smartUpscale = false, titleFromPrompt, upscaleBusy = false, width }: GalleryTileProps) {
  const mountedRef = useRef(false);
  const prefersReducedMotion = useReducedMotion();
  const isEntering = !mountedRef.current && (Date.now() - Date.parse(item.createdAt || "")) < 2000;
  useEffect(() => { mountedRef.current = true; }, []);
  const actions = useItemActions(item, "tile");
  const row = tileRow(actions, width);
  const profiles = React.useContext(GenerationProfiles);
  const phoneTiles = React.useContext(TileLongPressContext);
  const captionDetail = phoneTiles ? "" : tileCaptionDetail(item, profiles);
  const selection = React.useContext(GallerySelectionContext);
  const selectable = item.status === "done" || item.status === "error";
  const selecting = Boolean(selection?.selecting);
  const isSelected = Boolean(selecting && selection?.selected.has(item.id));
  // While selecting, a long press toggles too, so a slow tap never gets lost.
  const onLongPress = phoneTiles ? (selecting ? (selectable ? selection!.toggle : null) : phoneTiles.onLongPress) : null;
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const cancelPress = () => { if (press.current) window.clearTimeout(press.current.timer); };
  const longPress = onLongPress && item.status !== "pending" ? {
    onPointerDown: (event: React.PointerEvent) => {
      if (event.pointerType === "mouse") return;
      cancelPress();
      const state = { x: event.clientX, y: event.clientY, fired: false, timer: 0 };
      state.timer = window.setTimeout(() => { state.fired = true; onLongPress(item); }, 450);
      press.current = state;
    },
    onPointerMove: (event: React.PointerEvent) => {
      const state = press.current;
      if (state && Math.hypot(event.clientX - state.x, event.clientY - state.y) > 10) cancelPress();
    },
    onPointerUp: cancelPress,
    onPointerCancel: cancelPress,
    // The system's own long-press menu (save image, copy) would cover ours.
    onContextMenu: (event: React.MouseEvent) => { event.preventDefault(); if (!press.current?.fired) onLongPress(item); }
  } : null;
  return (
    <motion.div
      data-tile-id={item.id}
      className="tile-motion-wrap"
      style={{ width, height }}
      initial={prefersReducedMotion || !isEntering ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={tweens.base}
    >
      <button
        className={cn("tile", item.status, phoneTiles && "is-pressable", selecting && "is-selecting", isSelected && "is-selected")}
        style={{ width: "100%", height: "100%" } as React.CSSProperties}
        {...longPress}
        onKeyDown={(event) => {
          if (selection?.menu && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) selection.menu(item, event);
        }}
        onContextMenu={selection?.menu ? (event) => selection.menu!(item, event) : longPress?.onContextMenu}
        onClick={(event) => {
          // A long press already opened the actions; the lift that ends it is not a tap.
          if (press.current?.fired) { press.current = null; return; }
          if (selection?.click(item, event)) return;
          if (item.status !== "pending") openItem(item);
        }}
        aria-pressed={selecting && selectable ? isSelected : undefined}
      >
        {item.status === "pending" || item.status === "done" ? (
          <GenerationMedia item={item} muted>
          <GenerationProgress item={item} formatElapsed={formatElapsed} showModel={false} />
          </GenerationMedia>
        ) : item.status === "error" ? <FailureTile item={item} /> : <div className="generating stopped"><span>{titleFromPrompt(item.filename || "Failed")}</span></div>}
        {/* Desktop: the prompt, then when · which profile (· a video's length). The
            phone shows nothing over a tile unless Tile Captions is on, and then the
            prompt and the output's name or type, never the time (UI-PATTERNS › Phone). */}
        {phoneTiles && !phoneTiles.captions ? null : <span className="tile-caption">
          <strong>{titleFromPrompt(item.prompt || item.filename)}</strong>
          {phoneTiles
            ? item.status === "error" || item.status === "pending" ? null : <em>{item.outputName || item.type}</em>
            : captionDetail ? <em>{captionDetail}</em> : null}
        </span>}
      </button>
      {/* Controls are siblings of the tile's button, never inside it: a button
          inside a button is invalid and unreachable by keyboard. */}
      <div className={cn("tile-overlay", phoneTiles && "is-phone", selecting && selectable && "is-selecting")}>
        {selecting && selectable ? <span className={cn("tile-check", isSelected && "is-on")} aria-hidden="true">{isSelected ? <Check size={16} strokeWidth={2.5} /> : null}</span> : null}
        {smartUpscale && onUpscale && canUpscaleItem(item) ? <UpscaleButton item={item} busy={upscaleBusy} onUpscale={onUpscale} onCancelUpscale={onCancelUpscale} /> : null}
        {/* Beside Stop, in the overlay, so it holds still while the tile is hovered. Phones show only the progress. */}
        {item.status === "pending" && !phoneTiles ? <GenerationModel item={item} className="tile-action" /> : null}
        {item.status === "pending" && !phoneTiles ? <Tip content={item.progress?.upscaling ? "Stop the Upscale · The Picture Stays" : "Stop Generation"}><button type="button" className="tile-action" onClick={() => cancelJob(item.jobId)}>Stop</button></Tip> : null}
        {item.status !== "pending" && !phoneTiles && row.shown.length ? (
          // One row of glass circles along the top, in the viewer bar's order; what doesn't fit waits behind More.
          <span className="tile-hover-actions" role="group" aria-label="Item Actions">
            {row.shown.map((action, index) => {
              const name = action.tip || action.label;
              const className = cn(action.danger ? "tile-delete" : "tile-icon", action.id === "star" && "is-star", action.pressed && "is-on", startsGroup(row.shown, index) && "starts-group");
              const body = <ActionIcon action={action} size={14} />;
              return (
                <Tip key={action.id} content={name}>
                  {action.href
                    ? <a className={className} aria-label={name} href={action.href} download={downloadName(item)}>{body}</a>
                    : <button type="button" className={className} aria-label={name} aria-pressed={action.id === "star" ? Boolean(action.pressed) : undefined} onClick={action.run}>{body}</button>}
                </Tip>
              );
            })}
            {row.more ? (
              <Tip content="More Actions">
                <button type="button" className="tile-icon tile-more" aria-label="More Actions" aria-haspopup="menu" onClick={(event) => selection?.menu?.(item, event)}><MoreHorizontal size={14} /></button>
              </Tip>
            ) : null}
          </span>
        ) : null}
      </div>
    </motion.div>
  );
}

export const GalleryTile = React.memo(GalleryTileComponent, (previous, next) => {
  if (previous.item !== next.item) return false;
  if (previous.smartUpscale !== next.smartUpscale) return false;
  if (previous.upscaleBusy !== next.upscaleBusy) return false;
  if (previous.width !== next.width || previous.height !== next.height) return false;
  return true;
});
