import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { LogOut, Settings, UserRound } from 'lucide-react';
import { Tip } from './components';
import { signOutAccount } from './accounts';
import { useDismiss } from './useDismiss';
import { popoverMotion } from './composerSurface';

/**
 * The desktop dock's Account button: a small menu above it with Account
 * Settings and Sign Out, so signing out never means hunting through Settings.
 */
export function AccountMenu({ openAccount, onError }: { openAccount: () => void; onError: (message: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const root = React.useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => setOpen(false), []);
  useDismiss(root, open, close);
  const signOut = async () => {
    setBusy(true);
    try {
      await signOutAccount();
    } catch {
      setBusy(false);
      onError('Couldn’t sign out');
    }
  };
  return (
    <div className="account-menu" ref={root}>
      <Tip content="Account"><button type="button" className="icon-button" aria-label="Account" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><UserRound size={16} /></button></Tip>
      <AnimatePresence>
        {open ? (
          <motion.div className="account-menu-list" role="menu" aria-label="Account" {...popoverMotion}>
            <button type="button" role="menuitem" onClick={() => { close(); openAccount(); }}><Settings size={16} aria-hidden="true" />Account Settings</button>
            <button type="button" role="menuitem" className="is-danger" disabled={busy} onClick={() => void signOut()}><LogOut size={16} aria-hidden="true" />{busy ? 'Signing Out…' : 'Sign Out'}</button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
