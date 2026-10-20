import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useIsPresent } from 'framer-motion';
import { Layers, X } from 'lucide-react';
import { useDismiss } from './useDismiss';
import { composerAnchor, surfaceMotion, useComposerSurfaceBox } from './composerSurface';
import { usePhoneLayer } from './phoneLayers';
import { SurfaceStatus } from './StatusMessage';

function Surface({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const present = useIsPresent();
  const surface = React.useRef<HTMLDivElement>(null);
  const opener = React.useRef(document.querySelector<HTMLElement>('[data-open-trigger][aria-label="LoRAs"][aria-expanded="true"]') || (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const [anchor] = React.useState(() => composerAnchor(opener.current));
  const { box, asSheet } = useComposerSurfaceBox(anchor);
  // As a phone sheet it replaces the Create sheet rather than stacking on it.
  usePhoneLayer(Boolean(asSheet && present));
  const close = React.useCallback(() => { onClose(); opener.current?.focus({ preventScroll: true }); }, [onClose]);
  useDismiss([surface, opener], present, close);
  return createPortal(<motion.div ref={surface} className={`reference-popover composer-loras${asSheet ? ' is-sheet' : ''}`} style={asSheet ? undefined : box || undefined} role={present ? 'dialog' : undefined} aria-label="LoRAs" aria-hidden={!present || undefined} inert={!present} data-open-surface {...surfaceMotion}>
    <header className="reference-popover-head"><Layers size={16} /><strong>LoRAs</strong><SurfaceStatus active={Boolean(asSheet && present)} /><button type="button" className="reference-popover-close" aria-label="Close LoRAs" onClick={close}><X size={15} /></button></header>
    <div className="reference-popover-body lora-popover-body">{children}</div>
  </motion.div>, document.body);
}

export function LoraPopover({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  return <AnimatePresence>{open ? <Surface onClose={onClose}>{children}</Surface> : null}</AnimatePresence>;
}
