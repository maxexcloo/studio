import React from 'react';

/**
 * Drag to reorder a picked list (UI-PATTERNS › Pickers), with a mouse, a pen
 * or a finger: press the row's grip, move over another row, let go. Rows say
 * which they are with `data-reorder-key`; the list scrolls itself near its
 * edges. Arrow keys on the grip move it one place, for the keyboard.
 */
export function useReorderDrag(keys: string[], move: (from: number, to: number) => void, listRef: React.RefObject<HTMLElement | null>) {
  const dragging = React.useRef<string | null>(null);
  const [state, setState] = React.useState<{ dragging: string | null; over: string | null }>({ dragging: null, over: null });
  const keyAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-reorder-key]')?.dataset.reorderKey || null;
  const end = () => { dragging.current = null; setState({ dragging: null, over: null }); };
  const grip = (key: string) => ({
    'data-reorder-grip': '',
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragging.current = key;
      setState({ dragging: key, over: key });
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      if (!dragging.current) return;
      setState({ dragging: dragging.current, over: keyAt(event.clientX, event.clientY) });
      const list = listRef.current;
      if (list) {
        const box = list.getBoundingClientRect();
        if (event.clientY < box.top + 28) list.scrollTop -= 12;
        else if (event.clientY > box.bottom - 28) list.scrollTop += 12;
      }
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
      const from = keys.indexOf(dragging.current || '');
      const to = keys.indexOf(keyAt(event.clientX, event.clientY) || '');
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      end();
      if (from >= 0 && to >= 0 && from !== to) move(from, to);
    },
    onPointerCancel: end,
    onLostPointerCapture: () => { if (dragging.current) end(); },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      const index = keys.indexOf(key);
      const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : index;
      if (to === index) return;
      event.preventDefault();
      if (to >= 0 && to < keys.length) move(index, to);
    },
  });
  const rowState = (key: string) => ({ dragging: state.dragging === key, over: Boolean(state.dragging) && state.over === key && state.dragging !== key });
  return { grip, rowState };
}
