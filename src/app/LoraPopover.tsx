import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useIsPresent } from 'framer-motion';
import { Layers, SlidersHorizontal, X } from 'lucide-react';
import { useDismiss } from './useDismiss';
import { composerAnchor, surfaceMotion, useComposerSurfaceBox } from './composerSurface';
import { usePhoneLayer } from './phoneLayers';
import { SurfaceStatus } from './StatusMessage';
import { cn } from './format';

type SurfaceProps = { title: string; icon: React.ReactNode; trigger: string; className: string; bodyClassName: string; onClose: () => void; children: React.ReactNode };

/**
 * One popover above the composer (UI-PATTERNS › Surfaces): as wide as the
 * composer, anchored to it, the same glass, motion and dismissal for LoRAs and
 * Advanced Settings. On the phone it is a sheet that replaces the Create sheet.
 */
function Surface({ title, icon, trigger, className, bodyClassName, onClose, children }: SurfaceProps) {
  const present = useIsPresent();
  const surface = React.useRef<HTMLDivElement>(null);
  const opener = React.useRef(document.querySelector<HTMLElement>(trigger) || (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const [anchor] = React.useState(() => composerAnchor(opener.current));
  const { box, asSheet } = useComposerSurfaceBox(anchor);
  // As a phone sheet it replaces the Create sheet rather than stacking on it.
  usePhoneLayer(Boolean(asSheet && present));
  const close = React.useCallback(() => { onClose(); opener.current?.focus({ preventScroll: true }); }, [onClose]);
  useDismiss([surface, opener], present, close);
  return createPortal(<motion.div ref={surface} className={cn('reference-popover', className, asSheet && 'is-sheet')} style={asSheet ? undefined : box || undefined} role={present ? 'dialog' : undefined} aria-label={title} aria-hidden={!present || undefined} inert={!present} data-open-surface {...surfaceMotion}>
    <header className="reference-popover-head">{icon}<strong>{title}</strong><SurfaceStatus active={Boolean(asSheet && present)} /><button type="button" className="reference-popover-close" aria-label={`Close ${title}`} onClick={close}><X size={15} /></button></header>
    <div className={cn('reference-popover-body', bodyClassName)}>{children}</div>
  </motion.div>, document.body);
}

export function LoraPopover({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  return <AnimatePresence>{open ? <Surface title="LoRAs" icon={<Layers size={16} />} trigger='[data-open-trigger][aria-label="LoRAs"][aria-expanded="true"]' className="composer-loras" bodyClassName="lora-popover-body" onClose={onClose}>{children}</Surface> : null}</AnimatePresence>;
}

/** Advanced Settings in the same popover as LoRAs and References, above the composer. */
export function AdvancedPopover({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  return <AnimatePresence>{open ? <Surface title="Advanced Settings" icon={<SlidersHorizontal size={16} />} trigger='.composer-advanced-trigger[aria-expanded="true"]' className="composer-advanced" bodyClassName="composer-advanced-body" onClose={onClose}>{children}</Surface> : null}</AnimatePresence>;
}
