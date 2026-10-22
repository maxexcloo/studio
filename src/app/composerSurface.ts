import React from 'react';
import { tweens } from '@/lib/springs';

/**
 * The one popover entry (UI-PATTERNS › Motion): a fade and a scale from 0.96
 * at the trigger (set `transform-origin` there), at --motion-base in and
 * --motion-fast out. The glass blurs from its first frame (UI-PATTERNS › Glass).
 */
export const popoverMotion = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1, transition: tweens.base },
  exit: { opacity: 0, scale: 0.96, transition: tweens.fast },
  transition: tweens.base,
};

/** The margin every popover keeps from the screen's edges, and its gap from its trigger. */
export const POPOVER_MARGIN = 8;
export const POPOVER_GAP = 8;

export type AnchoredPlacement = {
  /** Viewport coordinates. */
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
  upward: boolean;
  /** Set on the surface so it scales from the trigger. */
  transformOrigin: string;
};

/**
 * Where a popover sits (UI-PATTERNS › Surfaces): directly above the button that
 * opened it, start-aligned to it and shifted to stay 8px inside the screen,
 * scaling from the trigger. A trigger near the top (a top bar's filters, a menu
 * in a header) has no room above, so the same rule flips and it opens below.
 * `width` is the surface's own width, clamped to `minWidth`…`maxWidth` and the
 * screen.
 */
export function anchoredPlacement(trigger: DOMRect, { width, minWidth = 0, maxWidth = Infinity, minHeight = 240, maxHeight = 560, prefer = 'above' }: { width: number; minWidth?: number; maxWidth?: number; minHeight?: number; maxHeight?: number; prefer?: 'above' | 'below' }): AnchoredPlacement {
  const view = window.visualViewport;
  const viewWidth = view?.width || window.innerWidth;
  const viewHeight = view?.height || window.innerHeight;
  const room = viewWidth - 2 * POPOVER_MARGIN;
  const w = Math.min(room, Math.max(minWidth, Math.min(maxWidth, width)));
  const left = Math.max(POPOVER_MARGIN, Math.min(trigger.left, viewWidth - POPOVER_MARGIN - w));
  const above = trigger.top - POPOVER_GAP - POPOVER_MARGIN;
  const below = viewHeight - trigger.bottom - POPOVER_GAP - POPOVER_MARGIN;
  const upward = prefer === 'above' ? above >= Math.min(minHeight, below) : below < Math.min(minHeight, above);
  const originX = Math.round(Math.max(0, Math.min(w, trigger.left + trigger.width / 2 - left)));
  return upward
    ? { left, width: w, bottom: window.innerHeight - trigger.top + POPOVER_GAP, maxHeight: Math.max(0, Math.min(maxHeight, above)), upward, transformOrigin: `${originX}px 100%` }
    : { left, width: w, top: trigger.bottom + POPOVER_GAP, maxHeight: Math.max(0, Math.min(maxHeight, below)), upward, transformOrigin: `${originX}px 0` };
}

/**
 * The anchored box for a portalled popover, kept up to date while it is open
 * (the trigger moving with a growing draft, the window resizing).
 */
export function useAnchoredBox(trigger: HTMLElement | null, options: Parameters<typeof anchoredPlacement>[1] & { fit?: boolean }, active = true) {
  const [box, setBox] = React.useState<React.CSSProperties | null>(null);
  const { width, minWidth, maxWidth, minHeight, maxHeight, prefer, fit } = options;
  React.useLayoutEffect(() => {
    if (!trigger || !active) return;
    const measure = () => {
      const place = anchoredPlacement(trigger.getBoundingClientRect(), { width, minWidth, maxWidth, minHeight, maxHeight, prefer });
      // Pickers take their full height (their lists scroll); `fit` surfaces size to their content.
      setBox({ position: 'fixed', left: place.left, width: place.width, top: place.top, bottom: place.bottom, [fit ? 'maxHeight' : 'height']: place.maxHeight, transformOrigin: place.transformOrigin });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(trigger);
    const host = trigger.closest('.zen-prompt');
    if (host) observer.observe(host);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('resize', measure); };
  }, [trigger, active, width, minWidth, maxWidth, minHeight, maxHeight, prefer, fit]);
  return box;
}

/**
 * The floating pickers above the composer (LoRAs, references, Advanced) share
 * one placement and motion (`popoverMotion`): above the button that opened them,
 * kept on screen however tall a draft grows. On the phone they pop up over the
 * Create sheet.
 */
export function composerAnchor(opener?: Element | null) {
  return (opener?.closest('.zen-prompt, .phone-create') || document.querySelector('.phone-create, .zen-prompt')) as HTMLElement | null;
}

/**
 * Where the surface sits. On the desktop: directly above the button that opened
 * it (`opener`, else the composer), start-aligned and kept on screen
 * (anchoredPlacement); `size.width` is its own width, `size.fit` lets it be as
 * short as its content. On the phone (the anchor is
 * the Create sheet) it is a pop-up over Create, anchored to the row that opened
 * it: above the row when the row sits low, below it otherwise, the screen's
 * width less a margin, and as tall as the room on that side allows. Create stays
 * in view behind it (UI-PATTERNS › Surfaces).
 */
export function useComposerSurfaceBox(anchor: HTMLElement | null, opener?: HTMLElement | null, size: { width?: number; fit?: boolean } = {}) {
  const [box, setBox] = React.useState<React.CSSProperties | null>(null);
  const onPhone = Boolean(anchor?.classList.contains('phone-create'));
  // The row it came from, found after the opening render commits (its aria-expanded is set by then) and
  // measured from there: rows don't move under a pop-up.
  const row = React.useRef<HTMLElement | null>(null);
  // The desktop: above the button that opened it (anchoredPlacement), as wide as a picker needs.
  const desktop = useAnchoredBox(onPhone ? null : opener || anchor, { width: size.width ?? 520, minWidth: 360, maxWidth: 560, maxHeight: size.fit ? 560 : 460, minHeight: 280, fit: size.fit }, !onPhone);
  React.useLayoutEffect(() => {
    if (!anchor || !onPhone) return;
    const from = opener && anchor.contains(opener) ? opener : anchor.querySelector<HTMLElement>('[aria-expanded="true"]');
    if (from) row.current = from.closest<HTMLElement>('.list-row') || from;
    const measure = () => {
      if (onPhone) {
        const view = window.visualViewport;
        const viewTop = view?.offsetTop || 0;
        const viewHeight = view?.height || window.innerHeight;
        const sheet = anchor.getBoundingClientRect();
        const rect = row.current?.getBoundingClientRect() || sheet;
        const top = Math.max(viewTop + 12, sheet.top + 8);
        const bottom = viewTop + viewHeight - 12;
        const above = rect.top - top - 6;
        const below = bottom - rect.bottom - 6;
        // Low rows (Model to Advanced) open upwards over the prompt; the keyboard's room counts.
        if (above >= below) setBox({ left: 10, right: 10, bottom: window.innerHeight - rect.top + 6, '--pop-max': `${Math.round(Math.min(above, 620))}px` } as React.CSSProperties);
        else setBox({ left: 10, right: 10, top: rect.bottom + 6, '--pop-max': `${Math.round(Math.min(below, 620))}px` } as React.CSSProperties);
        return;
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(anchor);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('resize', measure); };
  }, [anchor, onPhone, opener]);
  return { box: onPhone ? box : desktop, onPhone };
}
