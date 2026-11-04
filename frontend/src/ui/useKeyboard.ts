import { useEffect, useState, type RefObject } from "react";

/**
 * While `active`, follows the visual viewport for a full-screen phone surface being typed into
 * (`surface`, else the layout viewport): how far the visible viewport sits from its top (iOS
 * scrolls the page to the focused text) and how much of its bottom the keyboard covers. The page
 * returns where it was afterwards.
 */
export function useKeyboard(active: boolean, surface?: RefObject<HTMLElement | null>) {
  const [keyboard, setKeyboard] = useState({ top: 0, inset: 0 });
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!active || !viewport) return;
    const scrolled = window.scrollY;
    const resize = () => {
      const full = surface?.current?.clientHeight || window.innerHeight;
      setKeyboard({
        top: viewport.offsetTop,
        inset: Math.max(0, full - viewport.height - viewport.offsetTop),
      });
    };
    resize();
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
      setKeyboard({ top: 0, inset: 0 });
      if (window.scrollY !== scrolled) window.scrollTo({ top: scrolled });
    };
  }, [active]);
  return keyboard;
}
