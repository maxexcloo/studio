import React from 'react';
import { useReducedMotion } from 'framer-motion';
import { tweens } from '@/lib/springs';
import { cn } from './format';

/**
 * The composer keeps its natural height (typing a line resizes it in the same
 * frame). Only opening and closing animate: from the height it had just before
 * to the height its new content takes, measured after that content rendered,
 * so it never shrinks to a stale size and grows back.
 */
export function ExpandingComposer({ children, expanded, onExpandedChange }: {
  children: React.ReactNode;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const section = React.useRef<HTMLElement>(null);
  const lastHeight = React.useRef(0);
  const animating = React.useRef(false);
  const first = React.useRef(true);
  const reduced = useReducedMotion();

  // The settled height, kept up to date while nothing animates.
  React.useLayoutEffect(() => {
    const node = section.current;
    if (!node) return;
    lastHeight.current = node.offsetHeight;
    const observer = new ResizeObserver(() => { if (!animating.current) lastHeight.current = node.offsetHeight; });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  React.useLayoutEffect(() => {
    if (first.current) { first.current = false; return; }
    const node = section.current;
    if (!node) return;
    const from = lastHeight.current;
    const to = node.offsetHeight;
    lastHeight.current = to;
    if (reduced || !from || Math.abs(from - to) < 1) return;
    animating.current = true;
    node.style.overflow = 'hidden';
    node.style.height = `${from}px`;
    const inner = node.firstElementChild as HTMLElement | null;
    const edges = node.offsetHeight - (inner?.offsetHeight ?? node.offsetHeight);
    node.style.height = '';
    // Web Animations, not framer's animate(): framer renders its height once more a frame after
    // stop(), which landed after finish() and pinned the composer at a stale height (its foot cut off).
    let animation: Animation | null = null;
    const { duration, ease } = tweens.slow;
    const finish = () => { animation?.cancel(); animation = null; node.style.overflow = ''; animating.current = false; lastHeight.current = node.offsetHeight; observer.disconnect(); };
    const run = (start: number, target: number) => {
      animation?.cancel();
      animation = node.animate([{ height: `${start}px` }, { height: `${target}px` }], { duration: duration * 1000, easing: `cubic-bezier(${ease.join(', ')})` });
      animation.onfinish = finish;
    };
    // Content that settles mid-way (a row appearing) retargets the same movement instead of snapping at the end.
    let target = to;
    const observer = new ResizeObserver(() => {
      const next = (inner?.offsetHeight ?? target) + Math.max(0, edges);
      if (inner && Math.abs(next - target) >= 1) { target = next; run(node.getBoundingClientRect().height, target); }
    });
    if (inner) observer.observe(inner);
    run(from, to);
    return finish;
  }, [expanded, reduced]);

  return <section
    ref={section}
    className={cn('zen-prompt', expanded && 'is-expanded')}
    aria-label="Create"
    onFocusCapture={(event) => { if (!(event.target instanceof Element) || !event.target.closest('.generate')) onExpandedChange(true); }}
    onBlurCapture={(event) => {
      const next = event.relatedTarget;
      if (next instanceof Element && !event.currentTarget.contains(next) && !next.closest('[role="dialog"], [role="alertdialog"], [data-status-message], .dropdown-menu')) onExpandedChange(false);
    }}
  ><div className="composer-inner">{children}</div></section>;
}
