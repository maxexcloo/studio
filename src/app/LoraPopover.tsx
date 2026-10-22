import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useIsPresent } from 'framer-motion';
import { Layers, SlidersHorizontal, X } from 'lucide-react';
import { useDismiss } from './useDismiss';
import { composerAnchor, popoverMotion, useComposerSurfaceBox } from './composerSurface';
import { usePhoneLayer } from './phoneLayers';
import { cn } from './format';
import { SurfaceStatus } from './StatusMessage';
import { SurfaceHeadingContext, useSurfaceHeadingSlot } from './PickerTools';

type SurfaceProps = { title: string; icon: React.ReactNode; trigger: string; className: string; bodyClassName: string; onClose: () => void; children: React.ReactNode; /** Its own width on the desktop, and whether it is only as tall as its content. */ size?: { width?: number; fit?: boolean }; /** No heading on the desktop (Advanced Settings): Escape and an outside click close it. */ headless?: boolean };

/**
 * One popover above the button that opened it (UI-PATTERNS › Surfaces): the same
 * placement, glass, motion and dismissal for LoRAs and Advanced Settings. On the phone it pops up over the Create sheet, anchored to
 * the row that opened it (Model, LoRAs, Size and Advanced use it there).
 */
export function ComposerSurface({ title, icon, trigger, className, bodyClassName, onClose, children, size, headless = false }: SurfaceProps) {
  const present = useIsPresent();
  const surface = React.useRef<HTMLDivElement>(null);
  const opener = React.useRef(document.querySelector<HTMLElement>(trigger) || (document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null));
  // The trigger only reads aria-expanded="true" once this render commits, and iOS never focuses a tapped
  // button, so the opener is found again after the commit (before paint) and the box placed from it.
  const [, setOpenerFound] = React.useState(false);
  React.useLayoutEffect(() => {
    const found = document.querySelector<HTMLElement>(trigger);
    if (found && found !== opener.current) { opener.current = found; setOpenerFound(true); }
  }, [trigger]);
  const [anchor] = React.useState(() => composerAnchor(opener.current));
  const { box, onPhone } = useComposerSurfaceBox(anchor, opener.current, size);
  // On the phone it pops up over the Create sheet, which stays in view behind it.
  usePhoneLayer(Boolean(onPhone && present), 'pop');
  const close = React.useCallback(() => { onClose(); opener.current?.focus({ preventScroll: true }); }, [onClose]);
  useDismiss([surface, opener], present, close);
  const heading = useSurfaceHeadingSlot(title, Boolean(onPhone));
  return createPortal(<motion.div ref={surface} className={cn('reference-popover', className, onPhone && 'is-pop')} style={box || undefined} role={present ? 'dialog' : undefined} aria-label={title} aria-hidden={!present || undefined} inert={!present} data-open-surface {...popoverMotion}>
    {headless && !onPhone ? null : <header className="reference-popover-head">{icon}<strong className="surface-title">{title}</strong><span ref={heading.ref} className="surface-head-slot" />{onPhone ? <SurfaceStatus active={present} /> : null}<button type="button" className="reference-popover-close" aria-label={`Close ${title}`} onClick={close}><X size={16} /></button></header>}
    <SurfaceHeadingContext.Provider value={heading.value}><div className={cn('reference-popover-body', bodyClassName)}>{children}</div></SurfaceHeadingContext.Provider>
  </motion.div>, document.body);
}

/** The widest picker: its heading holds the views, the search field beside them, Stacks and Clear. */
const LORAS_SIZE = { width: 560 };

export function LoraPopover({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  return <AnimatePresence>{open ? <ComposerSurface title="LoRAs" icon={<Layers size={16} />} trigger='[data-open-trigger][aria-label="LoRAs"][aria-expanded="true"]' className="composer-loras" bodyClassName="lora-popover-body" size={LORAS_SIZE} onClose={onClose}>{children}</ComposerSurface> : null}</AnimatePresence>;
}

/** One column, as tall as its rows (UI-PATTERNS › Composer). */
const ADVANCED_SIZE = { width: 400, fit: true };

/** Advanced Settings in the same popover as LoRAs and References, above its button. */
export function AdvancedPopover({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  return <AnimatePresence>{open ? <ComposerSurface title="Advanced Settings" icon={<SlidersHorizontal size={16} />} trigger='[data-open-trigger][aria-label="Advanced Settings"][aria-expanded="true"]' className="composer-advanced" bodyClassName="composer-advanced-body" size={ADVANCED_SIZE} headless onClose={onClose}>{children}</ComposerSurface> : null}</AnimatePresence>;
}
