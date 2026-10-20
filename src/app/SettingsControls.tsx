import React from 'react';
import { cn } from './format';

/** Preference switches shown both in Settings and on the phone's More sheet, under one name. */
export const preferenceLabels = {
  confirmActions: 'Confirm Before Removing Things',
  showFailedItems: 'Show Failed Items',
  smartUpscale: 'Smart Upscale',
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

export function Group({ title, note, tone, children }: React.PropsWithChildren<{ title?: string; note?: React.ReactNode; tone?: 'danger' }>) {
  return (
    <section className="set-group">
      {title ? <h4 className="set-group-title">{title}</h4> : null}
      <div className={cn('set-card', tone === 'danger' && 'is-danger')}>{children}</div>
      {note ? <p className="set-note">{note}</p> : null}
    </section>
  );
}

export function Row({ label, description, children, stacked, disabled, className }: React.PropsWithChildren<{ label: React.ReactNode; description?: React.ReactNode; stacked?: boolean; disabled?: boolean; className?: string }>) {
  return (
    <div className={cn('set-row', stacked && 'is-stacked', disabled && 'is-disabled', className)}>
      <div className="set-row-text">
        <strong>{label}</strong>
        {description ? <span>{description}</span> : null}
      </div>
      {children ? <div className="set-row-control">{children}</div> : null}
    </div>
  );
}

/**
 * A switch row whose whole line is the switch (UI-PATTERNS › Settings): a
 * click or tap anywhere on the label, description or switch toggles it, and
 * Space or Enter does too. The row carries role="switch"; the knob inside is
 * drawn only.
 */
export function SwitchRow({ label, tag, description, checked, onChange, disabled }: { label: string; tag?: React.ReactNode; description?: React.ReactNode; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  const descriptionId = React.useId();
  return (
    <div
      className={cn('set-row set-switch-row', disabled && 'is-disabled')}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={description ? descriptionId : undefined}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={() => { if (!disabled) onChange(!checked); }}
      onKeyDown={(event) => {
        if (disabled || (event.key !== ' ' && event.key !== 'Enter') || event.target !== event.currentTarget) return;
        event.preventDefault();
        onChange(!checked);
      }}
    >
      <div className="set-row-text">
        <strong>{label}{tag}</strong>
        {description ? <span id={descriptionId}>{description}</span> : null}
      </div>
      <div className="set-row-control"><span className={cn('switch', checked && 'is-on')} aria-hidden="true" data-checked={checked}><span className="switch-thumb" /></span></div>
    </div>
  );
}

/** Save & Discard for an edited form, shown only while something changed. */
export function SaveRow({ dirty, busy, onSave, onDiscard, saveLabel = 'Save', note, canSave = true }: { dirty: boolean; busy?: boolean; onSave: () => void; onDiscard: () => void; saveLabel?: string; note?: React.ReactNode; canSave?: boolean }) {
  if (!dirty) return null;
  return (
    <div className="set-row set-save-row" role="group" aria-label="Unsaved Changes">
      <div className="set-row-text"><strong>Unsaved Changes</strong>{note ? <span>{note}</span> : null}</div>
      <div className="set-row-control">
        <button type="button" className="btn is-ghost" disabled={busy} onClick={onDiscard}>Discard</button>
        <button type="button" className="btn is-primary" disabled={busy || !canSave} onClick={onSave}>{busy ? 'Saving…' : saveLabel}</button>
      </div>
    </div>
  );
}

/** A status word with its coloured light. */
export function Status({ tone, children }: React.PropsWithChildren<{ tone?: 'ok' | 'bad' | 'warn' }>) {
  return <span className={cn('set-status', tone && `is-${tone}`)}><i aria-hidden="true" />{children}</span>;
}
