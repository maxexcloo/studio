import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { tweens } from '@/lib/springs';
import { cn } from './format';

/** Animate the actual content height, keeping the prompt, model and send mounted. */
export function ExpandingComposer({ children, expanded, onExpandedChange }: {
  children: React.ReactNode;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const body = React.useRef<HTMLDivElement>(null);
  const [height, setHeight] = React.useState<number>();
  const [animating, setAnimating] = React.useState(false);
  const reduced = useReducedMotion();
  // Only opening and closing spring; text growing a line resizes at once, so the bottom-anchored
  // composer never spills downward and then slides back up while typing.
  const toggledAt = React.useRef(-Infinity);
  const wasExpanded = React.useRef(expanded);
  if (wasExpanded.current !== expanded) { wasExpanded.current = expanded; toggledAt.current = performance.now(); }
  const toggling = performance.now() - toggledAt.current < 600;
  React.useLayoutEffect(() => {
    const node = body.current;
    if (!node) return;
    const measure = () => setHeight(node.offsetHeight + 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <motion.section
    className={cn('zen-prompt', expanded && 'is-expanded')}
    aria-label="Create"
    initial={false}
    animate={{ height: toggling && !reduced ? height ?? 'auto' : 'auto' }}
    transition={reduced || !toggling ? { duration: 0 } : tweens.slow}
    style={{ overflow: animating ? 'hidden' : 'visible' }}
    onAnimationStart={() => setAnimating(true)}
    onAnimationComplete={() => setAnimating(false)}
    onFocusCapture={(event) => { if (!(event.target instanceof Element) || !event.target.closest('.generate')) onExpandedChange(true); }}
    onBlurCapture={(event) => {
      const next = event.relatedTarget;
      if (next instanceof Element && !event.currentTarget.contains(next) && !next.closest('[role="dialog"], [role="alertdialog"], [data-status-message]')) onExpandedChange(false);
    }}
  ><div ref={body} className="composer-inner">{children}</div></motion.section>;
}
