import { useEffect, useState } from 'react';

/**
 * Keeps a surface in the page for its closing animation. `mounted` stays true
 * for `ms` after `open` turns false, with `closing` set meanwhile so CSS can
 * play the way out; opening again mid-close takes it straight back.
 */
export function usePresence(open: boolean, ms = 150) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setMounted(false);
      return;
    }
    setClosing(true);
    const id = window.setTimeout(() => { setMounted(false); setClosing(false); }, ms);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ms]);
  return { mounted: open || mounted, closing: !open && closing };
}
