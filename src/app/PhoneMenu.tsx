import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckSquare, Library, LogOut, Settings, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { usePhoneLayer } from './phoneLayers';
import { useDismiss } from './useDismiss';
import { popoverMotion } from './composerSurface';
import { cn } from './format';
import { signOutAccount } from './accounts';
import { useAccess } from './access';
import type { PhoneView } from './PhoneStudio';

export type PhoneMenuItem = { id: string; Icon: LucideIcon; label: string; run: () => void; danger?: boolean; disabled?: boolean; /** A count after the label, as on the desktop's Stop All. */ count?: number } | 'divider';

/**
 * A small pop-up menu anchored under a top-bar button, over the page
 * (UI-PATTERNS › Surfaces): compact rows with an icon, no boxes. The same
 * glass and motion as the Create pop-ups; one at a time (phoneLayers.ts).
 */
export function PhoneMenu({ open, onClose, trigger, label, items, align = 'right' }: { open: boolean; onClose: () => void; trigger: string; label: string; items: PhoneMenuItem[]; align?: 'left' | 'right' }) {
  const menuRef = React.useRef<HTMLDivElement>(null);
  const opener = React.useRef<HTMLElement | null>(null);
  if (open && !opener.current) opener.current = document.querySelector<HTMLElement>(trigger);
  if (!open) opener.current = null;
  usePhoneLayer(open, 'pop');
  useDismiss([menuRef, opener], open, onClose);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  const [left] = React.useState(() => 0);
  const anchorLeft = open && align === 'left' ? Math.max(8, (opener.current?.getBoundingClientRect().left || 8) - 4) : left;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div ref={menuRef} key="menu" className={cn('phone-menu', align === 'left' && 'is-left')} style={align === 'left' ? { left: anchorLeft, right: 'auto' } : undefined} role="menu" aria-label={label}
          {...popoverMotion}>
          {items.map((item, index) => item === 'divider'
            ? <i key={`divider-${index}`} className="phone-menu-divider" aria-hidden="true" />
            : <button key={item.id} type="button" role="menuitem" className={cn('phone-menu-item', item.danger && 'is-danger')} aria-label={item.count ? `${item.label} (${item.count})` : undefined} disabled={item.disabled} onClick={item.run}><item.Icon size={19} aria-hidden="true" /><span>{item.label}</span>{item.count ? <i className="phone-menu-count">{item.count}</i> : null}</button>)}
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

/** The top bar's menu: Select, Library, Settings, then Account and Sign Out. Gallery switches live in Settings; Stop All is in what's running. */
export function MoreMenu({ view, open, onClose, onSelect }: { view: Pick<PhoneView, 'models' | 'setLibraryOpen' | 'openSettings' | 'showToast'>; open: boolean; onClose: () => void; onSelect?: () => void }) {
  const [signingOut, setSigningOut] = React.useState(false);
  const { signedIn } = useAccess();
  const items: PhoneMenuItem[] = [];
  if (onSelect) items.push({ id: 'select', Icon: CheckSquare, label: 'Select', run: () => { onClose(); onSelect(); } });
  // Update Available shows as the Library's count, as the desktop dock's dot.
  if (view.models?.features?.library === true) items.push({ id: 'library', Icon: Library, label: 'Library', count: view.models.features.libraryUpdates || undefined, run: () => { onClose(); view.setLibraryOpen(true); } });
  items.push({ id: 'settings', Icon: Settings, label: 'Settings', run: () => { onClose(); view.openSettings('studio'); } });
  if (signedIn) items.push('divider',
    { id: 'account', Icon: UserRound, label: 'Account', run: () => { onClose(); view.openSettings('account'); } },
    { id: 'sign-out', Icon: LogOut, label: signingOut ? 'Signing Out…' : 'Sign Out', danger: true, disabled: signingOut, run: () => { setSigningOut(true); signOutAccount().catch(() => { setSigningOut(false); view.showToast('Couldn’t sign out', 'error'); }); } });
  return <PhoneMenu open={open} onClose={onClose} trigger=".phone-menu-trigger" label="Menu" items={items} />;
}
