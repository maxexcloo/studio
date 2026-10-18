import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { springs } from '@/lib/springs';
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
    initial={false}
    animate={{ height: height ?? 'auto' }}
    transition={reduced ? { duration: 0 } : springs.slow}
    style={{ overflow: animating ? 'hidden' : 'visible' }}
    onAnimationStart={() => setAnimating(true)}
    onAnimationComplete={() => setAnimating(false)}
    onFocusCapture={(event) => { if (!(event.target instanceof Element) || !event.target.closest('.generate')) onExpandedChange(true); }}
    onBlurCapture={(event) => {
      const next = event.relatedTarget;
      if (next instanceof Element && !event.currentTarget.contains(next) && !next.closest('[role="dialog"], [role="alertdialog"]')) onExpandedChange(false);
    }}
  ><div ref={body} className="composer-inner">{children}</div></motion.section>;
}
