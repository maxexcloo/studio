import { useCallback, useLayoutEffect, useRef, useState, type Ref } from 'react';

/** Size to text and available viewport space, then allow scrolling inside the field. */
export function useAutosizeTextarea(value: string, forwardedRef?: Ref<HTMLTextAreaElement>, maximum = 240, minimumRows?: number, enabled = true) {
  const minimums = useRef(new WeakMap<HTMLTextAreaElement, number>());
  const [field, setField] = useState<HTMLTextAreaElement | null>(null);
  const ref = useCallback((node: HTMLTextAreaElement | null) => {
    setField(node);
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  useLayoutEffect(() => {
    if (!field) return;
    // Off: the field fills the space its layout gives it (the phone's Create sheet).
    if (!enabled) { for (const property of ['height', 'minHeight', 'maxHeight', 'overflowY'] as const) field.style[property] = ''; return; }
    let width = -1;
    if (!minimums.current.has(field)) minimums.current.set(field, parseFloat(getComputedStyle(field).minHeight) || 44);
    const measure = () => {
      const style = getComputedStyle(field);
      const viewport = window.visualViewport?.height || window.innerHeight;
      const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
      const rowsHeight = minimumRows ? lineHeight * minimumRows + (style.boxSizing === 'border-box' ? padding + border : 0) : 0;
      const minimum = rowsHeight || minimums.current.get(field) || 44;
      const cap = Math.max(44, rowsHeight, Math.min(maximum, viewport * 0.28));
      field.style.maxHeight = `${cap}px`;
      field.style.minHeight = `${Math.min(cap, minimum)}px`;
      field.style.transition = 'none';
      field.style.height = '0px';
      const height = Math.min(cap, field.scrollHeight + (style.boxSizing === 'border-box' ? border : -padding));
      field.style.height = `${height}px`;
      field.style.overflowY = field.scrollHeight > field.clientHeight + 1 ? 'auto' : 'hidden';
    };
    measure();
    const observer = new ResizeObserver(() => {
      if (field.clientWidth === width) return;
      width = field.clientWidth;
      measure();
    });
    observer.observe(field);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [field, maximum, minimumRows, value, enabled]);
  return ref;
}
