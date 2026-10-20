import React from 'react';

/**
 * The floating pickers above the composer (LoRAs, references) share one place,
 * size and motion: as wide as the composer, kept on screen however tall a draft
 * grows, and quick to settle. On the phone they come up as a bottom sheet.
 */
export const surfaceMotion = {
  initial: { opacity: 0, y: 8, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 6, scale: 0.985 },
  transition: { type: 'spring' as const, duration: 0.22, bounce: 0.08 }
};

export function composerAnchor(opener?: Element | null) {
  return (opener?.closest('.zen-prompt, .phone-create') || document.querySelector('.phone-create, .zen-prompt')) as HTMLElement | null;
}

/** Where the surface sits: above the anchor, its width, and never taller than the room above it. */
export function useComposerSurfaceBox(anchor: HTMLElement | null) {
  const [box, setBox] = React.useState<React.CSSProperties | null>(null);
  React.useLayoutEffect(() => {
    if (!anchor) return;
    const measure = () => {
      const rect = anchor.getBoundingClientRect();
      // A long draft can leave less room above the composer than the usual height.
      const bottom = Math.min(window.innerHeight - rect.top + 10, window.innerHeight - 248);
      setBox({ left: rect.left, width: rect.width, bottom, height: Math.min(440, window.innerHeight * 0.58, window.innerHeight - bottom - 8) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(anchor);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [anchor]);
  return { box, asSheet: Boolean(anchor?.classList.contains('phone-create')) };
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
