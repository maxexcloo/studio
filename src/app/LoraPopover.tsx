import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useIsPresent } from 'framer-motion';
import { Layers, SlidersHorizontal, X } from 'lucide-react';
import { useDismiss } from './useDismiss';
import { composerAnchor, popoverMotion, useComposerSurfaceBox, useSettling } from './composerSurface';
import { usePhoneLayer } from './phoneLayers';
import { cn } from './format';
import { SurfaceStatus } from './StatusMessage';

type SurfaceProps = { title: string; icon: React.ReactNode; trigger: string; className: string; bodyClassName: string; onClose: () => void; children: React.ReactNode };

/**
 * One popover above the composer (UI-PATTERNS › Surfaces): as wide as the
 * composer, anchored to it, the same glass, motion and dismissal for LoRAs and
 * Advanced Settings. On the phone it pops up over the Create sheet, anchored to
 * the row that opened it (Model, LoRAs, Size and Advanced use it there).
 */
export function ComposerSurface({ title, icon, trigger, className, bodyClassName, onClose, children }: SurfaceProps) {
  const present = useIsPresent();
  const surface = React.useRef<HTMLDivElement>(null);
  const opener = React.useRef(document.querySelector<HTMLElement>(trigger) || (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const [anchor] = React.useState(() => composerAnchor(opener.current));
  const { box, onPhone } = useComposerSurfaceBox(anchor, opener.current);
  // On the phone it pops up over the Create sheet, which stays in view behind it.
  usePhoneLayer(Boolean(onPhone && present), 'pop');
  const close = React.useCallback(() => { onClose(); opener.current?.focus({ preventScroll: true }); }, [onClose]);
  useDismiss([surface, opener], present, close);
  const settling = useSettling();
  return createPortal(<motion.div ref={surface} className={cn('reference-popover', className, onPhone && 'is-pop')} style={box || undefined} role={present ? 'dialog' : undefined} aria-label={title} aria-hidden={!present || undefined} inert={!present} data-open-surface {...popoverMotion} {...settling}>
    <header className="reference-popover-head">{icon}<strong>{title}</strong>{onPhone ? <SurfaceStatus active={present} /> : null}<button type="button" className="reference-popover-close" aria-label={`Close ${title}`} onClick={close}><X size={16} /></button></header>
    <div className={cn('reference-popover-body', bodyClassName)}>{children}</div>
  </motion.div>, document.body);
}

export function LoraPopover({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  return <AnimatePresence>{open ? <ComposerSurface title="LoRAs" icon={<Layers size={16} />} trigger='[data-open-trigger][aria-label="LoRAs"][aria-expanded="true"]' className="composer-loras" bodyClassName="lora-popover-body" onClose={onClose}>{children}</ComposerSurface> : null}</AnimatePresence>;
}

/** Advanced Settings in the same popover as LoRAs and References, above the composer. */
export function AdvancedPopover({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  return <AnimatePresence>{open ? <ComposerSurface title="Advanced Settings" icon={<SlidersHorizontal size={16} />} trigger='[data-open-trigger][aria-label="Advanced Settings"][aria-expanded="true"]' className="composer-advanced" bodyClassName="composer-advanced-body" onClose={onClose}>{children}</ComposerSurface> : null}</AnimatePresence>;
}
