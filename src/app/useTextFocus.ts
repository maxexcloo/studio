import React from 'react';
import { useHistoryDismiss } from './useHistoryDismiss';

/** Whether the visible page is short of the screen by about a keyboard. */
function keyboardUp() {
  const viewport = window.visualViewport;
  if (!viewport) return false;
  const screenHeight = window.innerWidth > window.innerHeight ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
  return viewport.height < screenHeight * 0.75;
}

/**
 * Focused text editing on the phone (UI-PATTERNS › Phone › Keyboard): while a
 * long text field has the focus and the on-screen keyboard is up, it is the
 * only thing on screen, as tall as the room above the keyboard. The keyboard
 * counts as up when the visible part of the page (visualViewport) is well
 * short of the screen, so a hardware keyboard or a tall window leaves the
 * layout alone, and hiding the keyboard puts the field back too. Done, a
 * blur or Back (and Android's back gesture) put it back too. Spread `bind`
 * on the field's wrapper; its own buttons (History, Clear, Select All, Done)
 * keep the focus with `keepFocus`, so a tap on one doesn't close the field
 * under the finger.
 */
export function useTextFocus(enabled: boolean, onChange?: (focused: boolean) => void) {
  const [hasFocus, setFocused] = React.useState(false);
  const [keyboard, setKeyboard] = React.useState(false);
  React.useEffect(() => {
    if (!enabled || !hasFocus) return;
    const viewport = window.visualViewport;
    const update = () => setKeyboard(keyboardUp());
    update();
    viewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    return () => { viewport?.removeEventListener('resize', update); window.removeEventListener('resize', update); };
  }, [enabled, hasFocus]);
  const focused = hasFocus && keyboard;
  const wrapper = React.useRef<HTMLDivElement | null>(null);
  const changed = React.useRef(onChange);
  changed.current = onChange;
  React.useEffect(() => { changed.current?.(focused); }, [focused]);
  React.useEffect(() => { if (!enabled) setFocused(false); }, [enabled]);
  const done = React.useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && wrapper.current?.contains(active)) active.blur();
    setFocused(false);
  }, []);
  useHistoryDismiss(enabled && focused, done);
  // The caret stays in view as the field grows to fill the screen.
  React.useEffect(() => {
    if (!focused) return;
    const field = wrapper.current?.querySelector<HTMLTextAreaElement | HTMLInputElement>('textarea, input');
    if (!field) return;
    const frame = requestAnimationFrame(() => {
      if (field instanceof HTMLTextAreaElement && field.selectionEnd === field.value.length) field.scrollTop = field.scrollHeight;
      field.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [focused]);
  const bind = enabled ? {
    ref: wrapper,
    onFocus: (event: React.FocusEvent) => { if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) setFocused(true); },
    onBlur: (event: React.FocusEvent<HTMLElement>) => {
      const next = event.relatedTarget;
      if (next instanceof Node && event.currentTarget.contains(next)) return;
      setFocused(false);
    },
  } : { ref: wrapper };
  /** On a field's own buttons: the tap acts without taking the focus from the text. */
  const keepFocus = enabled ? { onPointerDown: (event: React.PointerEvent) => event.preventDefault() } : {};
  return { focused: enabled && focused, bind, done, keepFocus };
}
