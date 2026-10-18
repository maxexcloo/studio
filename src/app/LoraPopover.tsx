import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useIsPresent } from 'framer-motion';
import { Layers, X } from 'lucide-react';
import { useDismiss } from './useDismiss';

function Surface({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const present = useIsPresent();
  const surface = React.useRef<HTMLDivElement>(null);
  const opener = React.useRef(document.querySelector<HTMLElement>('[data-open-trigger][aria-label="LoRAs"][aria-expanded="true"]') || (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const anchor = opener.current?.closest('.zen-prompt, .phone-create') || document.querySelector('.phone-create, .zen-prompt');
  const asSheet = Boolean(anchor?.classList.contains('phone-create'));
  const [box, setBox] = React.useState<React.CSSProperties>();
  const close = React.useCallback(() => { onClose(); opener.current?.focus({ preventScroll: true }); }, [onClose]);
  useDismiss([surface, opener], present, close);
  React.useLayoutEffect(() => {
    if (!anchor) return;
    const measure = () => {
      const rect = anchor.getBoundingClientRect();
      // Long drafts can leave less room above the composer than the normal picker height.
      const bottom = Math.min(window.innerHeight - rect.top + 10, window.innerHeight - 248);
      setBox({ left: rect.left, width: rect.width, bottom, height: Math.min(440, window.innerHeight * .58, window.innerHeight - bottom - 8) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(anchor);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [anchor]);
  return createPortal(<motion.div ref={surface} className={`reference-popover composer-loras${asSheet ? ' is-sheet' : ''}`} style={asSheet ? undefined : box} role={present ? 'dialog' : undefined} aria-label="LoRAs" aria-hidden={!present || undefined} inert={!present} data-open-surface initial={{ opacity: 0, y: 10, scale: .97, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, y: 8, scale: .98, filter: 'blur(3px)' }} transition={{ type: 'spring', duration: .38, bounce: .12 }}>
    <header className="reference-popover-head"><Layers size={16} /><strong>LoRAs</strong><button type="button" className="reference-popover-close" aria-label="Close LoRAs" onClick={close}><X size={15} /></button></header>
    <div className="reference-popover-body lora-popover-body">{children}</div>
  </motion.div>, document.body);
}

export function LoraPopover({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  return <AnimatePresence>{open ? <Surface onClose={onClose}>{children}</Surface> : null}</AnimatePresence>;
}
