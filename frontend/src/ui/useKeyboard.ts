import { type RefObject, useEffect, useRef, useState } from "react";

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

/**
 * While `active`, the visual viewport within the layout viewport: the room a popup has above the
 * keyboard and a browser's toolbars.
 */
export function useVisibleRect(active: boolean) {
  const [rect, setRect] = useState<{ x: number; y: number; width: number; height: number }>();
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!active || !viewport) return setRect(undefined);
    const resize = () =>
      setRect({
        x: viewport.offsetLeft,
        y: viewport.offsetTop,
        width: viewport.width,
        height: viewport.height,
      });
    resize();
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
    };
  }, [active]);
  return rect;
}

/** While `active`, the owner of the focused field, or false for a field it does not own. */
export function useTypingIn<T>(active: boolean, ownerOf: (field: Element) => T | false) {
  const [typing, setTyping] = useState<T | false>(false);
  useEffect(() => {
    if (!active) return setTyping(false);
    let frame = 0;
    const check = () => {
      const field = document.activeElement;
      setTyping(field?.matches("input, textarea") ? ownerOf(field) : false);
    };
    // Moving between fields blurs one before focusing the next; check once focus has settled.
    const settled = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(check);
    };
    check();
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", settled);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", settled);
    };
  }, [active]);
  return typing;
}

/**
 * While a phone types in a centred dialog or chip sheet, fit that dialog above the keyboard.
 * The full-screen text editor follows the viewport itself.
 */
export function DialogKeyboard() {
  const owner = useTypingIn(usePhone(), (field) => {
    const dialog = field.closest(".mantine-Modal-content");
    return dialog?.matches(":not([data-full-screen]), [data-chip-popup]")
      ? dialog.parentElement || false
      : false;
  });
  const keyboard = useKeyboard(Boolean(owner));
  useEffect(() => {
    if (!owner) return;
    owner.style.top = `${keyboard.top}px`;
    owner.style.bottom = `${keyboard.inset}px`;
    return () => {
      owner.style.removeProperty("top");
      owner.style.removeProperty("bottom");
    };
  }, [owner, keyboard.top, keyboard.inset]);
  return null;
}
