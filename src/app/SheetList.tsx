import React from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from './format';

/*
 * The flat settings list every phone sheet uses (UI-PATTERNS › Lists): full
 * width rows split by hairlines, no cards or boxes. A row is one line: the
 * label on the left, its value (muted, cut short with an ellipsis) and a
 * chevron or check on the right. A section is a quiet heading over its rows.
 */

export function ListSection({ title, children, className }: { title?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('list-section', className)}>
      {title ? <h3 className="list-section-title">{title}</h3> : null}
      <div className="list-group">{children}</div>
    </section>
  );
}

type RowProps = {
  label: React.ReactNode;
  value?: React.ReactNode;
  /** Before the label: an icon, a shape. */
  lead?: React.ReactNode;
  /** chevron opens a step, check marks the selected option, none for inline controls. */
  end?: 'chevron' | 'check' | 'none';
  selected?: boolean;
  className?: string;
};

/** A row that opens a step or picks an option. */
export function ListButton({ label, value, lead, end = 'chevron', selected, className, ...button }: RowProps & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'value'>) {
  return (
    <button type="button" className={cn('list-row', selected && 'is-selected', className)} {...button}>
      {lead ? <span className="list-row-lead" aria-hidden="true">{lead}</span> : null}
      <span className="list-row-label">{label}</span>
      {value != null && value !== '' ? <span className="list-row-value">{value}</span> : <span className="list-row-gap" />}
      {end === 'chevron' ? <ChevronRight size={17} className="list-row-end" aria-hidden="true" /> : end === 'check' ? <Check size={17} className={cn('list-row-end list-row-check', !selected && 'is-off')} aria-hidden="true" /> : null}
    </button>
  );
}

/** A row that holds its own control on the right: a stepper, a field, a switch, a select. */
export function ListItem({ label, lead, children, className, htmlFor }: { label: React.ReactNode; lead?: React.ReactNode; children: React.ReactNode; className?: string; htmlFor?: string }) {
  const Tag = htmlFor ? 'label' : 'div';
  return (
    <Tag className={cn('list-row is-static', className)} {...(htmlFor ? { htmlFor } : {})}>
      {lead ? <span className="list-row-lead" aria-hidden="true">{lead}</span> : null}
      <span className="list-row-label">{label}</span>
      <span className="list-row-control">{children}</span>
    </Tag>
  );
}
