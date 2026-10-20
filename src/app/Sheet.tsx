import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'framer-motion';
import { ArrowLeft, X } from 'lucide-react';
import { cn } from './format';
import { useFocusTrap } from './useFocusTrap';
import { useHistoryDismiss } from './useHistoryDismiss';
import { usePhoneLayer } from './phoneLayers';
import { StatusPill, useStatusHost } from './StatusMessage';

/**
 * A bottom sheet: grab handle, swipe down (or Back, or Escape, or a tap on the
 * dimmed page) to close, focus kept inside while open. A sheet opened from
 * another replaces it (phoneLayers.ts): it shows Back instead of Close, and the
 * one under it hides until it closes.
 */
export function Sheet({ open, onClose, title, children, footer, full = false, className, headerAction }: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  full?: boolean;
  className?: string;
  headerAction?: React.ReactNode;
}) {
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const titleId = React.useId();
  const drag = useDragControls();
  const reduced = useReducedMotion();
  const { covered, nested } = usePhoneLayer(open);
  const message = useStatusHost(open && !covered);
  useFocusTrap(panelRef, open);
  useHistoryDismiss(open, onClose);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // A layer opened on top of this one closes first.
      if (covered) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, covered]);
  return createPortal(
    <AnimatePresence>
      {open ? (
        <React.Fragment key="sheet">
          {nested ? (
            // The sheet under this one keeps the dimmed page; a tap on it steps back.
            <button type="button" className="phone-sheet-backdrop is-nested" aria-label="Back" tabIndex={-1} onClick={onClose} />
          ) : (
            <motion.button
              type="button"
              className="phone-sheet-backdrop"
              aria-label="Close"
              tabIndex={-1}
              // Covered, a tap belongs to the layer on top (a picker closes itself on an outside tap).
              onClick={() => { if (!covered) onClose(); }}
              // The colour fades, not opacity: Safari runs framer's opacity fades as
              // hardware animations and shows the wrong end state for a frame when
              // one finishes, so the whole page behind would flash.
              initial={{ backgroundColor: 'rgba(0, 0, 0, 0)' }}
              animate={{ backgroundColor: 'rgba(0, 0, 0, 0.55)' }}
              exit={{ backgroundColor: 'rgba(0, 0, 0, 0)' }}
              transition={{ duration: 0.2 }}
            />
          )}
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className={cn('phone-sheet', full && 'is-full', nested && 'is-nested', covered && 'is-covered', className)}
            aria-hidden={covered || undefined}
            initial={reduced ? { opacity: 0 } : nested ? { opacity: 0, y: 24 } : { y: '100%' }}
            animate={reduced ? { opacity: 1 } : nested ? { opacity: 1, y: 0 } : { y: 0 }}
            exit={reduced ? { opacity: 0 } : nested ? { opacity: 0, y: 24 } : { y: '100%' }}
            transition={nested ? { duration: 0.2, ease: [0.2, 0, 0, 1] } : { type: 'spring', stiffness: 420, damping: 40 }}
            drag={reduced ? false : 'y'}
            dragControls={drag}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_event, info) => { if (info.offset.y > 110 || info.velocity.y > 600) onClose(); }}
          >
            <div className="phone-sheet-grab" onPointerDown={(event) => {
              // Header actions must keep their tap, even when a finger moves slightly.
              if (reduced || !event.isPrimary || event.button !== 0 || (event.target as Element).closest('button, a, input, select, textarea, [role="button"]')) return;
              drag.start(event);
            }}>
              <div className="phone-sheet-handle" aria-hidden="true" />
              <header className="phone-sheet-head">
                {nested ? <button type="button" className="phone-icon phone-sheet-back" aria-label="Back" onClick={onClose}><ArrowLeft size={20} /></button> : null}
                {/* A message takes the title's place for a moment, short of Back and Close (UI-PATTERNS › Messages). */}
                <h2 id={titleId} className={cn(message && 'sr-only')}>{title}</h2>
                {message ? <StatusPill message={message} className="is-surface" /> : null}
                {headerAction}
                {nested ? null : <button type="button" className="phone-icon" aria-label="Close" onClick={onClose}><X size={20} /></button>}
              </header>
            </div>
            <div className="phone-sheet-body">{children}</div>
            {footer ? <div className="phone-sheet-foot">{footer}</div> : null}
          </motion.div>
        </React.Fragment>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}
