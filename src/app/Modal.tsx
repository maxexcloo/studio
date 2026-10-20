import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { SurfaceStatus } from './StatusMessage';
import { cn } from '@/lib/utils';

/**
 * The one modal surface. Every dialog shares the same scrim, sheet, anatomy
 * (hero, head, body, foot) and dismiss rules:
 * - alert: small, never closes on an outside click, Escape cancels.
 * - form:  a task with fields; outside click closes unless busy.
 * - wide / sheet: libraries and settings; big, scrolls its body.
 * While `busy`, nothing dismisses it: not Escape, not the scrim, not the close button.
 */
/** Toasts float above dialogs; touching one is not a click outside. */
const isToast = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('[data-status-message]'));

export type ModalSize = 'alert' | 'form' | 'wide' | 'sheet';

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  size = 'form',
  tone = 'default',
  icon,
  hero,
  headerActions,
  footer,
  busy = false,
  dismissOnOutside = size !== 'alert',
  hideClose = false,
  initialFocus,
  className,
  bodyClassName,
  contentProps,
  children
}: React.PropsWithChildren<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  size?: ModalSize;
  tone?: 'default' | 'danger';
  icon?: React.ReactNode;
  hero?: React.ReactNode;
  headerActions?: React.ReactNode;
  footer?: React.ReactNode;
  busy?: boolean;
  dismissOnOutside?: boolean;
  hideClose?: boolean;
  initialFocus?: React.RefObject<HTMLElement | null>;
  className?: string;
  bodyClassName?: string;
  contentProps?: React.HTMLAttributes<HTMLDivElement>;
}>) {
  const openerRef = React.useRef<HTMLElement | null>(null);
  if (open && !openerRef.current && typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
    openerRef.current = document.activeElement;
  }
  if (!open) openerRef.current = null;
  const opener = openerRef.current;

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next && busy) return; onOpenChange(next); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-scrim">
          <Dialog.Content
            {...contentProps}
            data-open-surface
            role={size === 'alert' ? 'alertdialog' : 'dialog'}
            aria-busy={busy || undefined}
            {...(description ? {} : { 'aria-describedby': undefined })}
            className={cn('modal', `modal-${size}`, hero && 'has-hero', className)}
            onOpenAutoFocus={(event) => {
              if (!initialFocus) return;
              event.preventDefault();
              initialFocus.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              // Return focus to whatever opened us, if it still exists.
              if (opener?.isConnected) { event.preventDefault(); opener.focus(); }
            }}
            // A menu open inside the dialog (a multi-select, a size menu) takes its own Escape first.
            onEscapeKeyDown={(event) => { if (busy || (event.target instanceof Element && event.target.closest('[data-own-escape]'))) event.preventDefault(); }}
            onPointerDownOutside={(event) => { if (busy || !dismissOnOutside || isToast(event.target)) event.preventDefault(); }}
            onInteractOutside={(event) => { if (busy || !dismissOnOutside || isToast(event.target)) event.preventDefault(); }}
          >
            {hero}
            <header className="modal-head">
              {icon ? <div className={cn('modal-icon', tone === 'danger' && 'is-danger')}>{icon}</div> : null}
              <div className="modal-titles">
                <Dialog.Title>{title}</Dialog.Title>
                {description ? <Dialog.Description>{description}</Dialog.Description> : null}
              </div>
              {/* Messages show in the dialog's header while it covers the page (UI-PATTERNS › Messages). */}
              <SurfaceStatus active={open} />
              {headerActions ? <div className="modal-head-actions">{headerActions}</div> : null}
              {hideClose ? null : (
                <Dialog.Close className="modal-close" aria-label="Close" disabled={busy}><X size={15} /></Dialog.Close>
              )}
            </header>
            <div className={cn('modal-body', bodyClassName)}>{children}</div>
            {footer ? <footer className="modal-foot">{footer}</footer> : null}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
