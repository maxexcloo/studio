import React from 'react';
import { Check, ChevronRight, ChevronsUpDown, X } from 'lucide-react';
import { cn } from './format';
import { StudioSelect } from './components';

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

type SelectOption = { value: string; label: string; detail?: string };

/**
 * A row's select: the phone's own picker (a native select, its options with
 * their file names), the studio's select on the desktop. The row shows the
 * friendly name; a value no longer offered still shows as itself.
 */
export function ListSelect({ label, value, options, onChange, native }: { label: string; value: string; options: SelectOption[]; onChange: (value: string) => void; native: boolean }) {
  const known = options.some((option) => option.value === value);
  const all = known || !value ? options : [{ value, label: value }, ...options];
  if (native) {
    // The friendly name shows; the native select lies over it, invisible, so a tap opens the phone's picker.
    const current = all.find((option) => option.value === value);
    return (
      <span className="list-select">
        <span className="list-select-value">{current?.label || 'Not Set'}</span>
        <ChevronsUpDown size={14} aria-hidden="true" />
        <select value={value} aria-label={label} onChange={(event) => onChange(event.target.value)}>
          {all.map((option) => <option key={option.value} value={option.value}>{option.detail ? `${option.label} · ${option.detail}` : option.label}</option>)}
        </select>
      </span>
    );
  }
  return <StudioSelect ariaLabel={label} value={value} options={all.map((option) => ({ value: option.value, label: option.label }))} onChange={onChange} />;
}

/** The chooser's Clear Selection, beside its tabs (UI-PATTERNS › Pickers); a phone shows "Clear", as the tabs need the room. */
export function ClearSelection({ onClick }: { onClick: () => void }) {
  return <button type="button" className="picker-clear-all" aria-label="Clear Selection" onClick={onClick}><X size={13} aria-hidden="true" /><span className="picker-clear-long">Clear Selection</span><span className="picker-clear-short" aria-hidden="true">Clear</span></button>;
}
