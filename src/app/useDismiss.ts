import { useEffect, type RefObject } from 'react';

type Refs = RefObject<HTMLElement | null> | Array<RefObject<HTMLElement | null>>;

let releaseClick: (() => void) | null = null;

/**
 * Stops the click that ends this tap. It lets go after that click, at the next
 * tap (this one became a scroll and sent none) or after a moment, so a later
 * tap is never lost.
 */
function swallowNextClick() {
  releaseClick?.();
  const stop = (event: MouseEvent) => { event.preventDefault(); event.stopImmediatePropagation(); release(); };
  const nextTap = () => release();
  const timer = window.setTimeout(() => release(), 800);
  // The next tap's pointerdown, not this one's (still being dispatched).
  const arm = window.setTimeout(() => window.addEventListener('pointerdown', nextTap, true), 0);
  function release() {
    window.clearTimeout(timer);
    window.clearTimeout(arm);
    window.removeEventListener('click', stop, true);
    window.removeEventListener('pointerdown', nextTap, true);
    if (releaseClick === release) releaseClick = null;
  }
  window.addEventListener('click', stop, true);
  releaseClick = release;
}

/**
 * Shared dismiss behaviour for inline menus and popovers: a pointer down outside
 * `ref` (or any of several refs, for a surface portaled elsewhere) or Escape
 * closes it. Escape is swallowed so it never also exits zen, closes the viewer
 * or leaves a modal the menu lives in.
 */
export function useDismiss(refs: Refs, open: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!open) return;
    const list = Array.isArray(refs) ? refs : [refs];
    const inside = (node: Node | null) => Boolean(node && list.some((ref) => ref.current?.contains(node)));
    const owns = (dialog: Element) => list.some((ref) => ref.current && (ref.current.contains(dialog) || dialog.contains(ref.current)));
    // A dialog opened from inside the surface (say, a delete confirmation) is
    // part of it: clicks and Escape there belong to the dialog.
    const inForeignDialog = (target: EventTarget | null) => {
      const dialog = target instanceof Element ? target.closest('[role="dialog"], [role="alertdialog"]') : null;
      return Boolean(dialog && !owns(dialog));
    };
    const dialogOpen = () => Array.from(document.querySelectorAll('[role="dialog"]:not([data-focus-trap]), [role="alertdialog"]')).some((dialog) => !dialog.closest('[inert], [aria-hidden="true"]') && !owns(dialog));
    function onPointerDown(event: PointerEvent) {
      if (inForeignDialog(event.target)) return;
      // The status message (an Undo, a Dismiss) is never a click away from the surface.
      if (event.target instanceof Element && event.target.closest('[data-status-message]')) return;
      // A dropdown's menu (Dropdown.tsx) floats on the page but belongs to the surface its trigger is in.
      if (event.target instanceof Element && event.target.closest('.dropdown-menu')) return;
      if (inside(event.target as Node)) return;
      onDismiss();
      // On a touch screen the tap that closes a pop-up only closes it: the click iOS sends after it
      // would land on whatever is under the finger once the surface is gone (a Create row that
      // opens the next pop-up, a tile that opens the viewer), so it looks as if nothing closed.
      if (event.pointerType !== 'mouse') swallowNextClick();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || dialogOpen()) return;
      // A field that undoes its own edit on Escape (a rename) keeps it; the surface stays open.
      if (event.target instanceof Element && event.target.closest('[data-own-escape]')) return;
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
    }
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onDismiss, ...(Array.isArray(refs) ? refs : [refs])]);
}
