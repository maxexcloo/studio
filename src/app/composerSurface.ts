import React from 'react';
import { tweens } from '@/lib/springs';

/**
 * The one popover entry (UI-PATTERNS › Motion): a fade and a scale from 0.96
 * at the trigger (set `transform-origin` there), at --motion-base in and
 * --motion-fast out. Spread it with `{...useSettling()}` so the glass does not
 * blur while it moves.
 */
export const popoverMotion = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1, transition: tweens.base },
  exit: { opacity: 0, scale: 0.96, transition: tweens.fast },
  transition: tweens.base,
};

/**
 * The floating pickers above the composer (LoRAs, references) share one place,
 * size and motion (`popoverMotion`): as wide as the composer, kept on screen
 * however tall a draft grows. On the phone they pop up over the Create sheet.
 */
export function composerAnchor(opener?: Element | null) {
  return (opener?.closest('.zen-prompt, .phone-create') || document.querySelector('.phone-create, .zen-prompt')) as HTMLElement | null;
}

/**
 * Where the surface sits. On the desktop: above the anchor (the composer), its
 * width, and never taller than the room above it. On the phone (the anchor is
 * the Create sheet) it is a pop-up over Create, anchored to the row that opened
 * it: above the row when the row sits low, below it otherwise, the screen's
 * width less a margin, and as tall as the room on that side allows. Create stays
 * in view behind it (UI-PATTERNS › Surfaces).
 */
export function useComposerSurfaceBox(anchor: HTMLElement | null, opener?: HTMLElement | null) {
  const [box, setBox] = React.useState<React.CSSProperties | null>(null);
  const onPhone = Boolean(anchor?.classList.contains('phone-create'));
  // The row it came from, measured once at opening: rows don't move under a pop-up.
  const [row] = React.useState(() => onPhone ? (opener?.closest<HTMLElement>('.list-row') || opener || anchor?.querySelector<HTMLElement>('[aria-expanded="true"]') || null) : null);
  React.useLayoutEffect(() => {
    if (!anchor) return;
    const measure = () => {
      if (onPhone) {
        const view = window.visualViewport;
        const viewTop = view?.offsetTop || 0;
        const viewHeight = view?.height || window.innerHeight;
        const sheet = anchor.getBoundingClientRect();
        const rect = row?.getBoundingClientRect() || sheet;
        const top = Math.max(viewTop + 12, sheet.top + 8);
        const bottom = viewTop + viewHeight - 12;
        const above = rect.top - top - 6;
        const below = bottom - rect.bottom - 6;
        // Low rows (Model to Advanced) open upwards over the prompt; the keyboard's room counts.
        if (above >= below) setBox({ left: 10, right: 10, bottom: window.innerHeight - rect.top + 6, '--pop-max': `${Math.round(Math.min(above, 620))}px` } as React.CSSProperties);
        else setBox({ left: 10, right: 10, top: rect.bottom + 6, '--pop-max': `${Math.round(Math.min(below, 620))}px` } as React.CSSProperties);
        return;
      }
      const rect = anchor.getBoundingClientRect();
      // A long draft can leave less room above the composer than the usual height.
      const bottom = Math.min(window.innerHeight - rect.top + 10, window.innerHeight - 248);
      setBox({ left: rect.left, width: rect.width, bottom, height: Math.min(440, window.innerHeight * 0.58, window.innerHeight - bottom - 8) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(anchor);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('resize', measure); };
  }, [anchor, onPhone, row]);
  return { box, onPhone };
}

/**
 * While a glass surface moves in or out it skips its backdrop blur (a solid
 * fill stands in, `[data-settling]` in 18-surfaces.css): re-blurring the page
 * behind on every frame of the motion is what made sheets and popovers stutter.
 * The glass returns once it settles. Spread onto the moving motion element.
 */
export function useSettling() {
  const [settling, setSettling] = React.useState(true);
  return {
    'data-settling': settling ? '' : undefined,
    onAnimationStart: () => setSettling(true),
    onAnimationComplete: () => setSettling(false),
  };
}
