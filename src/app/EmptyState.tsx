import React from 'react';
import { cn } from './format';

/**
 * What a picker, tab or list shows when it has nothing to list: plain muted
 * words centred in the space, no box and no icon. A Title Case heading, at
 * most one sentence-case line, and at most one way forward
 * (UI-PATTERNS › Empty States).
 */
export function EmptyState({ title, children, action, compact = false, className }: { title: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode; compact?: boolean; className?: string }) {
  return (
    <div className={cn("empty-state", compact && "is-compact", className)} role="status">
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}
