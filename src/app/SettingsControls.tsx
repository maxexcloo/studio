import React from 'react';
import { ExternalLink as ExternalLinkIcon } from 'lucide-react';
import { cn } from './format';

/** Preference switches shown both in Settings and on the phone's More sheet, under one name. */
export const preferenceLabels = {
  confirmActions: 'Confirm Before Removing Things',
  showFailedItems: 'Show Failed Items',
  smartUpscale: 'Upscale',
} as const;

export function Switch({ checked, onChange, disabled, label, size = 'md' }: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; label: string; size?: 'sm' | 'md' }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={cn('switch', size === 'sm' && 'is-sm')} onClick={() => onChange(!checked)}>
      <span className="switch-thumb" />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: React.ReactNode }>; onChange: (next: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" role="radio" aria-checked={value === option.value} className={cn(value === option.value && 'active')} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/*
 * A group's heading may carry one action on its right (`action`), such as
 * New Account: a small link-style button on the heading's line.
 *
 * Settings rows are the flat list every phone sheet uses (SheetList.tsx,
 * 41-lists.css, UI-PATTERNS › Lists and › Settings): a quiet heading over
 * full-width rows split by hairlines, no cards. A Settings row may carry one
 * line of description under its label.
 */
export function Group({ title, action, note, tone, children, className }: React.PropsWithChildren<{ title?: string; action?: React.ReactNode; note?: React.ReactNode; tone?: 'danger'; className?: string }>) {
  return (
    <section className={cn('list-section set-group', tone === 'danger' && 'is-danger', className)}>
      {title && action ? <div className="set-group-head"><h4 className="list-section-title">{title}</h4>{action}</div>
        : title ? <h4 className="list-section-title">{title}</h4> : null}
      <div className="list-group">{children}</div>
      {note ? <p className="list-note">{note}</p> : null}
    </section>
  );
}

function RowText({ label, description, descriptionId }: { label: React.ReactNode; description?: React.ReactNode; descriptionId?: string }) {
  return (
    <span className="list-row-text">
      <span className="list-row-label">{label}</span>
      {description ? <span className="list-row-detail" id={descriptionId}>{description}</span> : null}
    </span>
  );
}

export function Row({ label, description, children, stacked, disabled, className }: React.PropsWithChildren<{ label: React.ReactNode; description?: React.ReactNode; stacked?: boolean; disabled?: boolean; className?: string }>) {
  return (
    <div className={cn('list-row is-static set-row', stacked && 'is-stacked', disabled && 'is-disabled', className)}>
      <RowText label={label} description={description} />
      {children ? <span className="list-row-control">{children}</span> : null}
    </div>
  );
}

/**
 * A switch row whose whole line is the switch (UI-PATTERNS › Settings): the
 * row is the button with role="switch", so a click or tap anywhere on the
 * label, description or knob toggles it, and Space or Enter does too. The
 * knob is drawn from its state. The phone lists use the same (ListSwitch).
 */
export function SwitchRow({ label, tag, description, checked, onChange, disabled }: { label: string; tag?: React.ReactNode; description?: React.ReactNode; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  const descriptionId = React.useId();
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} aria-describedby={description ? descriptionId : undefined} disabled={disabled} className="list-row list-switch set-row" onClick={() => onChange(!checked)}>
      <RowText label={<>{label}{tag}</>} description={description} descriptionId={descriptionId} />
      <span className="switch" data-checked={checked} aria-hidden="true"><span className="switch-thumb" /></span>
    </button>
  );
}

/** Save & Discard for an edited form, its last row, shown only while something changed. */
export function SaveRow({ dirty, busy, onSave, onDiscard, saveLabel = 'Save', note, canSave = true }: { dirty: boolean; busy?: boolean; onSave: () => void; onDiscard: () => void; saveLabel?: string; note?: React.ReactNode; canSave?: boolean }) {
  if (!dirty) return null;
  return (
    <div className="list-row is-static set-row set-save-row" role="group" aria-label="Unsaved Changes">
      <RowText label="Unsaved Changes" description={note} />
      <span className="list-row-control">
        <button type="button" className="btn is-ghost" disabled={busy} onClick={onDiscard}>Discard</button>
        <button type="button" className="btn is-primary" disabled={busy || !canSave} onClick={onSave}>{busy ? 'Saving…' : saveLabel}</button>
      </span>
    </div>
  );
}

/** A status word with its coloured light. */
export function Status({ tone, children }: React.PropsWithChildren<{ tone?: 'ok' | 'bad' | 'warn' }>) {
  return <span className={cn('set-status', tone && `is-${tone}`)}><i aria-hidden="true" />{children}</span>;
}

/** A row's only control when it leaves Studio: a plain link on the right, no button chrome (UI-PATTERNS › Lists). */
export function ExternalLink({ href, children, label }: { href: string; children: React.ReactNode; label?: string }) {
  return <a className="set-link" href={href} target="_blank" rel="noreferrer" aria-label={label}>{children}<ExternalLinkIcon size={12} aria-hidden="true" /></a>;
}

/** The small text button on a group's heading line (Group's `action`). */
export function GroupAction({ children, ...button }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className="set-group-action" {...button}>{children}</button>;
}
