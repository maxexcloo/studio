import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, MoreHorizontal, Square } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from './format';
import { Tip } from './components';
import { GenerationMedia } from './GenerationPreview';
import { ElapsedTime } from './ElapsedTime';
import { GenerationModel, GenerationProgress } from './GenerationProgress';
import { FailureTile } from './GenerationFailure';
import type { GalleryItem } from './types';
import { canUpscaleItem, upscaleTooltip, useUpscaleClock } from './useUpscale';
import { UpscaleArrow } from './UpscaleArrow';
import { UpscaleNoticePopover } from './UpscaleNotice';
import type { UpscaleNotice } from './useUpscale';
import { useDismiss } from './useDismiss';
import { GallerySelectionContext } from './gallerySelection';
import { downloadName } from './share';
import { useItemActions } from './itemActions';
import { ActionIcon } from './ItemActionSurfaces';

/**
 * The phone studio's tiles: no corner buttons, a long press opens the tile's
 * actions as a sheet instead. Null everywhere else.
 */
export type PhoneTiles = {
  onLongPress: (item: GalleryItem) => void;
};
export const TileLongPressContext = React.createContext<PhoneTiles | null>(null);

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
  upscaleNotice?: UpscaleNotice;
  onDismissUpscaleNotice?: (id: string) => void;
};

function UpscaleButton({ item, busy, onUpscale, onCancelUpscale, held = false }: { item: GalleryItem; busy: boolean; onUpscale: (item: GalleryItem) => void; onCancelUpscale: (item: GalleryItem) => void; held?: boolean }) {
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
        className={cn("tile-upscale", active && "is-active", running && "is-running", running && !ratio && "is-indeterminate", running && clock.ratio !== null && "is-timed", busy && "is-busy", held && "is-held")}
        aria-label={tooltip}
        aria-pressed={state?.url ? active : undefined}
        aria-disabled={busy}
        onClick={() => { if (!busy) (running ? onCancelUpscale(item) : onUpscale(item)); }}
      >
        {busy ? <Loader2 size={14} className="spin" /> : running ? <Square size={10} fill="currentColor" strokeWidth={0} /> : <UpscaleArrow size={15} />}
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

const tileEnterTransition = {
  type: "spring" as const,
  stiffness: 380,
  damping: 32,
  mass: 0.86,
};

function GalleryTileComponent({ cancelJob, formatElapsed, height, item, onUpscale, onCancelUpscale = () => {}, openItem, smartUpscale = false, titleFromPrompt, upscaleBusy = false, upscaleNotice, onDismissUpscaleNotice, width }: GalleryTileProps) {
  const mountedRef = useRef(false);
  const prefersReducedMotion = useReducedMotion();
  const isEntering = !mountedRef.current && (Date.now() - Date.parse(item.createdAt || "")) < 2000;
  useEffect(() => { mountedRef.current = true; }, []);
  const actions = useItemActions(item, "tile");
  const star = actions.find((action) => action.id === "star");
  // Phones get one "More" button instead of a row of circles that would not fit.
  const [menuOpen, setMenuOpen] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useDismiss(overlayRef, menuOpen, closeMenu);
  const act = (run: () => void) => { setMenuOpen(false); run(); };
  const phoneTiles = React.useContext(TileLongPressContext);
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
      initial={prefersReducedMotion || !isEntering ? false : { opacity: 0, y: -18, scale: 0.965 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        opacity: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
        y: tileEnterTransition,
        scale: tileEnterTransition,
      }}
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
        <span className="tile-caption">
          <strong>{titleFromPrompt(item.prompt || item.filename)}</strong>
          {/* A failed tile already says so in its middle; "Failed" again is noise. */}
          {item.status === "error" ? null : <em>{item.status === "pending" ? <ElapsedTime startedAt={item.createdAt} format={formatElapsed} /> : (item.timing?.runMs || item.durationMs) ? formatElapsed(item.timing?.runMs || item.durationMs || 0) : item.outputName || item.type}</em>}
        </span>
      </button>
      {/* Controls are siblings of the tile's button, never inside it: a button
          inside a button is invalid and unreachable by keyboard. */}
      <div ref={overlayRef} className={cn("tile-overlay", menuOpen && "is-menu-open", phoneTiles && "is-phone", selecting && selectable && "is-selecting")}>
        {selecting && selectable ? <span className={cn("tile-check", isSelected && "is-on")} aria-hidden="true">{isSelected ? <Check size={16} strokeWidth={3} /> : null}</span> : null}
        {smartUpscale && onUpscale && canUpscaleItem(item) ? <UpscaleButton item={item} busy={upscaleBusy} onUpscale={onUpscale} onCancelUpscale={onCancelUpscale} held={Boolean(upscaleNotice)} /> : null}
        {upscaleNotice && onDismissUpscaleNotice ? <UpscaleNoticePopover notice={upscaleNotice} placement="tile" onDismiss={() => onDismissUpscaleNotice(item.id)} /> : null}
        {/* Beside Stop, in the overlay, so it holds still while the tile lifts on hover. */}
        {item.status === "pending" ? <GenerationModel item={item} className="tile-action" /> : null}
        {item.status === "pending" ? <Tip content={item.progress?.upscaling ? "Stop the Upscale · The Picture Stays" : "Stop Generation"}><button type="button" className="tile-action" onClick={() => cancelJob(item.jobId)}>Stop</button></Tip> : null}
        {item.status !== "pending" ? (
          <>
            <button type="button" className="tile-more" aria-label="More Actions" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}><MoreHorizontal size={16} /></button>
            <span className="tile-hover-actions">
              {actions.map((action) => {
                if (action.id === 'star') return null;
                const name = action.tip || action.label;
                const className = action.danger ? "tile-delete" : "tile-icon";
                const body = <><ActionIcon action={action} size={action.href ? 13 : 14} /><span className="tile-menu-label">{action.label}</span></>;
                return (
                  <Tip key={action.id} content={name} side="left">
                    {action.href
                      ? <a className={className} aria-label={name} href={action.href} download={downloadName(item)} onClick={() => setMenuOpen(false)}>{body}</a>
                      : <button type="button" className={className} aria-label={name} onClick={() => act(action.run)}>{body}</button>}
                  </Tip>
                );
              })}
            </span>
            {/* Its own corner: always there once starred, on hover otherwise. */}
            {star ? (
              <Tip content={star.label} side="left">
                <button type="button" className={cn("tile-star", star.pressed && "is-on")} aria-label={star.label} aria-pressed={star.pressed} onClick={() => act(star.run)}>
                  <ActionIcon action={star} size={14} />
                </button>
              </Tip>
            ) : null}
          </>
        ) : null}
      </div>
    </motion.div>
  );
}

export const GalleryTile = React.memo(GalleryTileComponent, (previous, next) => {
  if (previous.item !== next.item) return false;
  if (previous.smartUpscale !== next.smartUpscale) return false;
  if (previous.upscaleBusy !== next.upscaleBusy) return false;
  if (previous.upscaleNotice !== next.upscaleNotice) return false;
  if (previous.width !== next.width || previous.height !== next.height) return false;
  return true;
});
