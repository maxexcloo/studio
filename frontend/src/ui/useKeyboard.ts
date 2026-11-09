import { useEffect, useState, type RefObject } from "react";
import { usePhone } from "./usePhone";

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
