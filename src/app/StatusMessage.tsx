import React, { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from './format';
import { dismissToast, runToastAction, subscribeToasts, toastSnapshot, type ToastRecord } from './toast';
import { usePageHidden, usePausableTimeout } from '@/hooks/use-pausable-timeout';

/*
 * Messages show in the Studio status pill (docs/guides/UI-PATTERNS.md ›
 * Messages), never as a floating toast. The pill lives where the status lives:
 * the phone's top bar, the desktop dock. A surface that covers it (a sheet,
 * the viewer, a dialog) hosts the same pill at its own top edge while open.
 * Hosts register in mount order; only the newest shows the message, so one
 * message is never on screen twice.
 */

let hosts: number[] = [];
let nextHost = 1;
const hostListeners = new Set<() => void>();
const emitHosts = () => hostListeners.forEach((listener) => listener());
const subscribeHosts = (listener: () => void) => { hostListeners.add(listener); return () => { hostListeners.delete(listener); }; };
const hostSnapshot = () => hosts;

/** The message this host shows: the front one while it is the newest open host, otherwise null. */
export function useStatusHost(active = true): ToastRecord | null {
  const id = useRef(0);
  if (!id.current) id.current = nextHost++;
  useLayoutEffect(() => {
    if (!active) return;
    const own = id.current;
    hosts = [...hosts, own];
    emitHosts();
    return () => { hosts = hosts.filter((host) => host !== own); emitHosts(); };
  }, [active]);
  const live = useSyncExternalStore(subscribeHosts, hostSnapshot, hostSnapshot);
  const messages = useSyncExternalStore(subscribeToasts, toastSnapshot, toastSnapshot);
  return active && live[live.length - 1] === id.current ? messages[0] || null : null;
}

/** Every message for screen readers, wherever the pill is: polite, errors assertive. Mount once. */
export function StatusAnnouncer() {
  const messages = useSyncExternalStore(subscribeToasts, toastSnapshot, toastSnapshot);
  const front = messages[0];
  const text = front ? messageText(front) : '';
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite">{front && front.tone !== 'error' ? text : ''}</div>
      <div className="sr-only" role="alert" aria-live="assertive">{front?.tone === 'error' ? text : ''}</div>
    </>
  );
}

function messageText(message: ToastRecord) {
  const title = message.count > 1 && message.plural ? message.plural(message.count) : message.title;
  return message.count > 1 && !message.plural ? `${title} ×${message.count}` : title;
}

/**
 * The pill showing one message: the status light in the message's tone, the
 * words, its action (Undo, View, Try Again) and a Dismiss. It times out like
 * a toast did (errors wait), pauses while hovered or focused, and a sideways
 * flick dismisses it. `children` is what the pill shows between messages,
 * such as the phone's "Studio"; without it the pill is only there for one.
 */
export function StatusPill({ message, className, children }: { message: ToastRecord | null; className?: string; children?: React.ReactNode }) {
  const reduced = useReducedMotion();
  const pageHidden = usePageHidden();
  const [held, setHeld] = useState(false);
  usePausableTimeout(message ? message.duration : null, () => { if (message) dismissToast(message.id); }, held || pageHidden, message ? `${message.id}:${message.version}` : '');
  if (!message && !children) return null;
  const fade = reduced ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0, transition: { duration: 0.1 } } } : {
    initial: { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4, transition: { duration: 0.12 } },
    transition: { duration: 0.18, ease: [0.2, 0, 0, 1] as const }
  };
  return (
    <motion.div
      className={cn('status-pill', message && 'status-message', message && `is-${message.tone}`, className)}
      data-status-message={message ? '' : undefined}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, transition: { duration: 0.12 } }}
      transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
      drag={message ? 'x' : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.5}
      dragSnapToOrigin
      onDragEnd={(_, info) => { if (message && (Math.abs(info.offset.x) > 48 || Math.abs(info.velocity.x) > 420)) dismissToast(message.id); }}
      onPointerEnter={(event) => { if (event.pointerType === 'mouse') setHeld(true); }}
      onPointerLeave={(event) => { if (event.pointerType === 'mouse') setHeld(false); }}
      onFocus={() => setHeld(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setHeld(false); }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {message ? (
          <motion.span key={`m:${message.id}:${message.title}`} className="status-pill-body" {...fade}>
            <i className="status-pill-light" aria-hidden="true" />
            <span className="status-pill-text" title={messageText(message)}>{messageText(message)}</span>
            {message.actionLabel ? <button type="button" className="status-pill-action" onClick={() => runToastAction(message.id)}>{message.actionLabel}</button> : null}
            <button type="button" className="status-pill-close" aria-label="Dismiss" onClick={() => dismissToast(message.id)}><X size={13} /></button>
          </motion.span>
        ) : (
          <motion.span key="rest" className="status-pill-body" {...fade}>{children}</motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/** A surface's own copy of the pill, at its top edge, while it covers the top bar. */
export function SurfaceStatus({ active = true, className }: { active?: boolean; className?: string }) {
  const message = useStatusHost(active);
  return <AnimatePresence>{message ? <StatusPill key="surface" message={message} className={cn('is-surface', className)} /> : null}</AnimatePresence>;
}
