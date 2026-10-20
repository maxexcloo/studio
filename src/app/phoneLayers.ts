import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { coverMedia } from './mediaCover';

/*
 * One layer above the main screen (docs/guides/UI-PATTERNS.md). Every phone
 * sheet, pop-up and menu registers while open, as one of two kinds:
 *
 * - A `sheet` replaces what is under it: the sheets below hide until it
 *   closes, and a nested sheet shows Back.
 * - A `pop` (a picker or menu anchored over the Create sheet or the top bar)
 *   leaves the sheet under it in view, dimmed and inert, so Create stays where
 *   it was and its title row keeps showing messages.
 */

type Kind = 'sheet' | 'pop';
type Entry = { id: number; kind: Kind };
let stack: Entry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => stack;

export function usePhoneLayer(open: boolean, kind: Kind = 'sheet') {
  const id = useRef(0);
  if (!id.current) id.current = nextId++;
  useLayoutEffect(() => {
    if (!open) return;
    const own = id.current;
    stack = [...stack, { id: own, kind }];
    emit();
    // A layer over the gallery or the viewer pauses what plays behind it.
    const uncover = coverMedia();
    return () => { stack = stack.filter((item) => item.id !== own); emit(); uncover(); };
  }, [open, kind]);
  const layers = useSyncExternalStore(subscribe, snapshot, snapshot);
  const index = layers.findIndex((item) => item.id === id.current);
  const above = index >= 0 ? layers.slice(index + 1) : [];
  const sheetsBelow = index > 0 ? layers.slice(0, index).filter((item) => item.kind === 'sheet') : [];
  return {
    /** Something is open on top: this layer leaves Escape and outside taps to it. */
    covered: above.length > 0,
    /** A sheet replaced this one: it hides until that closes. */
    hidden: above.some((item) => item.kind === 'sheet'),
    /** Only a pop-up is on top: this one stays in view, dimmed. */
    overlaid: above.length > 0 && above.every((item) => item.kind === 'pop'),
    nested: kind === 'sheet' && sheetsBelow.length > 0,
  };
}
