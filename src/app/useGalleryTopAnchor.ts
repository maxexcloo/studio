import { useEffect, type RefObject } from 'react';

/**
 * Keeps the desktop gallery still while what sits above it changes height.
 *
 * The toolbar is sticky inside the gallery's own scroller, and the space
 * above the tiles grows and shrinks with it: an activity pill joining or
 * leaving the top (`--islands-h`), the filter row opening under the toolbar,
 * the search widening. At the top of the gallery the tiles make room, as they
 * should; scrolled down, the same change would shove every tile on screen up
 * or down. So once scrolled, the scroll position moves by exactly as much as
 * the gallery did and the tiles stay where they are, under the bars.
 *
 * Mutation and resize observers report the change after layout and before
 * the frame paints, so nothing shows in between.
 */
export function useGalleryTopAnchor(stageRef: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const stage = stageRef.current;
    if (!enabled || !stage) return;
    const shell = stage.closest('.app-shell') || stage.parentElement;
    let gallery: Element | null = null;
    let offset = 0;
    // Where the gallery starts in the scroller's content, whatever the scroll.
    const measure = (element: Element) => element.getBoundingClientRect().top - stage.getBoundingClientRect().top + stage.scrollTop;
    const check = () => {
      const current = stage.querySelector(':scope > .gallery');
      if (!current) { gallery = null; return; }
      const next = measure(current);
      const moved = next - offset;
      if (current === gallery && Math.abs(moved) > 0.5 && stage.scrollTop > 0) stage.scrollTop += moved;
      gallery = current;
      offset = next;
    };
    check();
    const mutations = new MutationObserver(check);
    if (shell) mutations.observe(shell, { attributes: true, attributeFilter: ['style', 'class'] });
    // The toolbar's own rows (the filter panel, the search) and the gallery being replaced.
    mutations.observe(stage, { childList: true });
    const toolbar = stage.querySelector('.gallery-toolbar');
    if (toolbar) mutations.observe(toolbar, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    const sizes = new ResizeObserver(check);
    if (toolbar) sizes.observe(toolbar);
    return () => { mutations.disconnect(); sizes.disconnect(); };
  }, [enabled, stageRef]);
}
