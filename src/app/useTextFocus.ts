import React from 'react';
import { useHistoryDismiss } from './useHistoryDismiss';

/**
 * Focused text editing on the phone (UI-PATTERNS › Phone › Keyboard): while a
 * long text field has the focus, it is the only thing on screen, as tall as
 * the room above the keyboard. Done, a blur or Back (and Android's back
 * gesture) put it back. Spread `bind` on the field's wrapper; its own buttons
 * (History, Clear, Select All, Done) keep the focus with `keepFocus`, so a tap
 * on one doesn't close the field under the finger.
 */
export function useTextFocus(enabled: boolean, onChange?: (focused: boolean) => void) {
  const [focused, setFocused] = React.useState(false);
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
