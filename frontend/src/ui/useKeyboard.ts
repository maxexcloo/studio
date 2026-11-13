import { useEffect, useRef, useState, type RefObject } from "react";
import { usePhone } from "./usePhone";

/**
 * While `active`, follows the visual viewport: how far it sits from the layout viewport's top (iOS
 * scrolls the page to the focused text) and how much of the layout viewport's bottom lies below it,
 * behind the keyboard. A full-screen phone `surface` being typed into moves down by `top` instead,
 * so `inset` is how much of the moved surface lies below it, even before the surface mounts. The
 * page returns where it was afterwards.
 */
export function useKeyboard(active: boolean, surface?: RefObject<HTMLElement | null>) {
  const [keyboard, setKeyboard] = useState({ top: 0, inset: 0 });
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!active || !viewport) return;
    const scrolled = window.scrollY;
    const resize = () => {
      const below = surface
        ? (surface.current?.clientHeight || window.innerHeight) - viewport.height
        : window.innerHeight - viewport.height - viewport.offsetTop;
      setKeyboard({ top: viewport.offsetTop, inset: Math.max(0, below) });
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

/**
 * Calls `onDrop` once the keyboard, having risen while `active`, drops again while its text keeps
 * focus (Android's Back): the gap between the window and the visible viewport, which a keyboard
 * opens by several hundred pixels, closes. A browser's toolbar folding away above the keyboard or
 * iOS scrolling to the text changes the gap far less, so neither reads as the keyboard dropping.
 */
export function useKeyboardDrop(active: boolean, onDrop: () => void) {
  const drop = useRef(onDrop);
  drop.current = onDrop;
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!active || !viewport) return;
    let risen = false;
    const resize = () => {
      const gap = window.innerHeight - viewport.height;
      if (gap > 200) risen = true;
      // A keyboard dropping because its text lost focus, such as to a tool's menu, is not Back.
      else if (risen && gap < 100 && document.activeElement?.matches("input, textarea"))
        drop.current();
    };
    viewport.addEventListener("resize", resize);
    return () => viewport.removeEventListener("resize", resize);
  }, [active]);
}

/** While `active`, whether a text field that `within` accepts has focus. */
export function useTypingIn(active: boolean, within: (field: Element) => boolean) {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!active) return setTyping(false);
    const check = () => {
      const field = document.activeElement;
      setTyping(Boolean(field?.matches("input, textarea") && within(field)));
    };
    // Moving between fields blurs one before focusing the next; check once focus has settled.
    const settled = () => requestAnimationFrame(check);
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", settled);
    return () => {
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", settled);
    };
  }, [active]);
  return typing;
}

/**
 * While a phone types in a centred dialog's field, fits every dialog to the visible viewport
 * (`--studio-dialog-top` and `--studio-dialog-inset`, read by the theme's Modal), so its footer
 * stays reachable above the keyboard instead of behind it.
 */
export function useDialogKeyboard() {
  const typing = useTypingIn(usePhone(), (field) =>
    Boolean(field.closest(".mantine-Modal-content:not([data-full-screen])")),
  );
  const keyboard = useKeyboard(typing);
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--studio-dialog-top", `${keyboard.top}px`);
    root.setProperty("--studio-dialog-inset", `${keyboard.inset}px`);
  }, [keyboard.top, keyboard.inset]);
}
