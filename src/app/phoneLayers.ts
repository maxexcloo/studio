import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';

/*
 * One layer above the main screen (docs/guides/UI-PATTERNS.md). Every phone
 * sheet and sheet-style picker registers while open; only the newest shows,
 * the ones under it hide until it closes, so a picker opened from Create
 * replaces Create and Back returns to it instead of stacking on top.
 */

let stack: number[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => stack;

export function usePhoneLayer(open: boolean) {
  const id = useRef(0);
  if (!id.current) id.current = nextId++;
  useLayoutEffect(() => {
    if (!open) return;
    const own = id.current;
    stack = [...stack, own];
    emit();
    return () => { stack = stack.filter((item) => item !== own); emit(); };
  }, [open]);
  const layers = useSyncExternalStore(subscribe, snapshot, snapshot);
  const index = layers.indexOf(id.current);
  return { covered: index >= 0 && index < layers.length - 1, nested: index > 0 };
}
