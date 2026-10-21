import React, { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { tweens } from '@/lib/springs';
import { X } from 'lucide-react';
import { cn } from './format';
import { SafeImg } from './SafeImg';
import { dismissToast, runToastAction, subscribeToasts, toastSnapshot, type ToastRecord } from './toast';
import { usePageHidden, usePausableTimeout } from '@/hooks/use-pausable-timeout';

/*
 * Messages show in the Studio status pill (docs/guides/UI-PATTERNS.md ›
 * Messages), never as a floating toast. On the desktop the pill lives in the
 * gallery's top bar, and a surface that covers it (the viewer, a dialog)
 * hosts the same pill at its own top edge while open. The phone has one host
 * for the whole app (PhoneStatus): the top of the screen, above every sheet
 * and pop-up. Hosts register in mount order; only the newest shows the
 * message, and an exclusive host (the phone's) wins over every other, so one
 * message is never on screen twice.
 */

type Host = { id: number; exclusive: boolean };
let hosts: Host[] = [];
let nextHost = 1;
const hostListeners = new Set<() => void>();
const emitHosts = () => hostListeners.forEach((listener) => listener());
const subscribeHosts = (listener: () => void) => { hostListeners.add(listener); return () => { hostListeners.delete(listener); }; };
const hostSnapshot = () => hosts;

/**
 * The message this host shows: the front one while it is the newest open host
 * (or the newest exclusive one, which every other gives way to), otherwise null.
 */
export function useStatusHost(active = true, exclusive = false): ToastRecord | null {
  const id = useRef(0);
  if (!id.current) id.current = nextHost++;
  useLayoutEffect(() => {
    if (!active) return;
    const own = id.current;
    hosts = [...hosts, { id: own, exclusive }];
    emitHosts();
    return () => { hosts = hosts.filter((host) => host.id !== own); emitHosts(); };
  }, [active, exclusive]);
  const live = useSyncExternalStore(subscribeHosts, hostSnapshot, hostSnapshot);
  const messages = useSyncExternalStore(subscribeToasts, toastSnapshot, toastSnapshot);
  const exclusives = live.filter((host) => host.exclusive);
  const winner = (exclusives.length ? exclusives : live)[(exclusives.length ? exclusives : live).length - 1];
  return active && winner?.id === id.current ? messages[0] || null : null;
}

/**
 * The phone's one status pill (UI-PATTERNS › Messages): at the top of the
 * screen, centred on the top bar's line, outside every box and header, as
 * wide as the screen allows, and above every sheet and pop-up (--z-phone-status).
 * A question's panel hangs under it. It is kept out of a dialog's aria-hidden
 * (aria-live="off": the announcer speaks the words), so a question stays
 * reachable while Settings is open.
 */
export function PhoneStatus({ message }: { message: ToastRecord | null }) {
  return createPortal(
    <div className={cn('phone-status', message?.confirm && 'is-question')} aria-live="off">
      <AnimatePresence>{message ? <StatusPill key="phone" message={message} className="is-phone" /> : null}</AnimatePresence>
    </div>,
    document.body
  );
}

/** Every message for screen readers, wherever the pill is: polite, errors assertive. Mount once. */
export function StatusAnnouncer() {
  const messages = useSyncExternalStore(subscribeToasts, toastSnapshot, toastSnapshot);
  const front = messages[0];
  const text = front ? messageText(front) : '';
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite">{front && front.tone !== 'error' ? text : ''}</div>
      {/* An alert is announced as it appears, so it exists only while there is one. */}
      {front?.tone === 'error' ? <div className="sr-only" role="alert" aria-live="assertive">{text}</div> : null}
    </>
  );
}

/** A repeat of the same message folds into the one on screen: its words only change when it counts something (`plural`). */
function messageText(message: ToastRecord) {
  return message.count > 1 && message.plural ? message.plural(message.count) : message.title;
}

/**
 * The pill showing one message: the status light in the message's tone, the
 * words, its action (Undo, View, Try Again) and a Dismiss. It times out like
 * a toast did, pauses while hovered or focused, and a sideways
 * flick dismisses it. `children` is what the pill shows between messages,
 * such as the phone's "Studio"; without it the pill is only there for one.
 */
export function StatusPill({ message, className, children }: { message: ToastRecord | null; className?: string; children?: React.ReactNode }) {
  const reduced = useReducedMotion();
  const pageHidden = usePageHidden();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused || pageHidden;
  usePausableTimeout(message ? message.duration : null, () => { if (message) dismissToast(message.id); }, paused, message ? `${message.id}:${message.version}` : '');
  if (!message && !children) return null;
  const fade = reduced ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0, transition: tweens.instant } } : {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0, transition: tweens.fast },
    transition: tweens.base
  };
  return (
    <motion.div
      className={cn('status-pill', message && 'status-message', message && `is-${message.tone}`, className)}
      data-status-message={message ? '' : undefined}
      role={message?.confirm ? 'alertdialog' : undefined}
      aria-label={message?.confirm ? message.title : undefined}
      aria-description={message?.confirm?.detail || undefined}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, transition: tweens.fast }}
      transition={tweens.base}
      drag={message && !message.confirm ? 'x' : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.5}
      dragSnapToOrigin
      onDragEnd={(_, info) => { if (message && (Math.abs(info.offset.x) > 48 || Math.abs(info.velocity.x) > 420)) dismissToast(message.id); }}
      onPointerEnter={(event) => { if (event.pointerType === 'mouse') setHovered(true); }}
      onPointerLeave={(event) => { if (event.pointerType === 'mouse') setHovered(false); }}
      onFocus={() => setFocused(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setFocused(false); }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {message ? (
          <motion.span key={`m:${message.id}:${message.title}`} className="status-pill-body" {...fade}>
            <i className="status-pill-light" aria-hidden="true" />
            {message.confirm ? (
              // A question: the words (and one line on what happens), then Cancel and the answer.
              <span className="status-pill-text is-question" title={messageText(message)}>{messageText(message)}</span>
            ) : <span className="status-pill-text" title={messageText(message)}>{messageText(message)}</span>}
            {message.confirm ? <ConfirmPanel title={messageText(message)} confirm={message.confirm} /> : null}
            {message.confirm ? <ConfirmButtons message={message} /> : <>
              {message.actionLabel ? <button type="button" className="status-pill-action" onClick={() => runToastAction(message.id)}>{message.actionLabel}</button> : null}
              <button type="button" className="status-pill-close" aria-label="Dismiss" onClick={() => dismissToast(message.id)}>{Number.isFinite(message.duration) ? <svg key={`${message.id}:${message.version}`} className="status-pill-countdown" viewBox="0 0 28 28" aria-hidden="true" style={{ animationDuration: `${message.duration}ms`, animationPlayState: paused ? 'paused' : 'running' }}><circle cx="14" cy="14" r="12" pathLength="1" /></svg> : null}<X size={14} /></button>
            </>}
          </motion.span>
        ) : (
          <motion.span key="rest" className="status-pill-body" {...fade}>{children}</motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * A question's whole text under the pill: the question with its count, the
 * line on what happens, and what it acts on (a thumbnail and a short name
 * each, scrolling when there are many).
 */
function ConfirmPanel({ title, confirm }: { title: string; confirm: NonNullable<ToastRecord['confirm']> }) {
  // The question is already the pill's words; the panel adds only what happens and what it acts on.
  return <div className="status-pill-panel" aria-label={title}>
    {confirm.detail ? <p>{confirm.detail}</p> : null}
    {confirm.items?.length ? <ul className="status-pill-list" aria-label="Items">
      {confirm.items.map((item) => <li key={item.id}>
        <SafeImg src={item.thumb} alt="" loading="lazy" decoding="async" fallback={<span className="status-pill-list-blank" aria-hidden="true" />} />
        <span>{item.name}</span>
      </li>)}
    </ul> : null}
  </div>;
}

/** A question's answers: Cancel takes the focus first, so Enter never removes anything by accident; Escape cancels. */
function ConfirmButtons({ message }: { message: ToastRecord }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { cancel.current?.focus({ preventScroll: true }); }, [message.id]);
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); dismissToast(message.id); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [message.id]);
  return <>
    <button ref={cancel} type="button" className="status-pill-action is-cancel" onClick={() => dismissToast(message.id)}>Cancel</button>
    <button type="button" className={cn('status-pill-action', message.confirm?.destructive ? 'is-danger' : 'is-primary')} onClick={() => runToastAction(message.id)}>{message.actionLabel}</button>
  </>;
}

/** A surface's own copy of the pill, at its top edge, while it covers the top bar. */
export function SurfaceStatus({ active = true, className }: { active?: boolean; className?: string }) {
  const message = useStatusHost(active);
  return <AnimatePresence>{message ? <StatusPill key="surface" message={message} className={cn('is-surface', className)} /> : null}</AnimatePresence>;
}
