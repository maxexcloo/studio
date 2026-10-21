import React from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { cn } from './format';
import { useDismiss } from './useDismiss';
import { EmptyState } from './EmptyState';

export type MultiSelectOption = { value: string; label: string; detail?: string; disabled?: boolean; reason?: string };

/**
 * A dropdown that picks several values (UI-PATTERNS › Settings): the trigger
 * names the one picked or counts them, the menu ticks values with All and
 * Clear in its head, a search field once the list is long, and disabled values
 * say why. It opens in the dialog it sits in, so focus and clicks stay there.
 */
export function MultiSelect({ label, values, options, onChange, disabled, allLabel = 'All', noneLabel = 'None', searchFrom = 8 }: {
  label: string; values: string[]; options: MultiSelectOption[]; onChange: (values: string[]) => void;
  disabled?: boolean; allLabel?: string; noneLabel?: string; searchFrom?: number;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [place, setPlace] = React.useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  const anchor = React.useRef<HTMLButtonElement>(null);
  const menu = React.useRef<HTMLDivElement>(null);
  const list = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  const close = React.useCallback(() => { setOpen(false); anchor.current?.focus({ preventScroll: true }); }, []);
  useDismiss([anchor, menu], open, close);

  React.useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    // Inside a dialog the menu joins it: a modal dialog ignores clicks and focus outside itself.
    const container = anchor.current.closest<HTMLElement>('[role="dialog"]') || document.body;
    setHost(container);
    const position = (event?: Event) => {
      if (event?.target instanceof Node && menu.current?.contains(event.target)) return;
      const rect = anchor.current!.getBoundingClientRect();
      // A transformed dialog is the containing block of fixed children.
      const offset = container !== document.body && getComputedStyle(container).transform !== 'none' ? container.getBoundingClientRect() : { left: 0, top: 0 };
      const bottom = window.visualViewport?.height || window.innerHeight;
      const below = bottom - rect.bottom - 16;
      const above = rect.top - 16;
      const maxHeight = Math.max(160, Math.min(360, Math.max(below, above)));
      const width = Math.max(rect.width, 260);
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      const top = below >= Math.min(240, above) ? rect.bottom + 6 : rect.top - Math.min(maxHeight, above) - 6;
      setPlace({ left: left - offset.left, top: top - offset.top, width, maxHeight: below >= Math.min(240, above) ? Math.min(maxHeight, below) : Math.min(maxHeight, above) });
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [open]);

  React.useEffect(() => {
    if (open && place) list.current?.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)')?.focus({ preventScroll: true });
  }, [open, Boolean(place)]); // eslint-disable-line react-hooks/exhaustive-deps

  const enabled = options.filter((option) => !option.disabled);
  const picked = values.filter((value) => options.some((option) => option.value === value));
  const labelOf = (value: string) => options.find((option) => option.value === value)?.label || value;
  const summary = !picked.length ? noneLabel : enabled.length > 1 && enabled.every((option) => picked.includes(option.value)) ? allLabel : picked.length === 1 ? labelOf(picked[0]) : `${picked.length} Selected`;
  const toggle = (value: string) => onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = options.filter((option) => terms.every((term) => `${option.label} ${option.detail || ''}`.toLocaleLowerCase().includes(term)));
  const searchable = options.length >= searchFrom;

  return <>
    <button ref={anchor} type="button" className="fluid-select-trigger multi-select-trigger" disabled={disabled} aria-label={label} title={picked.length ? picked.map(labelOf).join(', ') : undefined} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => { if (!open) setQuery(''); setOpen(!open); }} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}>
      <span>{summary}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && host && place ? createPortal(<div ref={menu} className="aspect-menu gallery-filter-menu multi-select-menu" style={{ left: place.left, top: place.top, width: place.width, maxHeight: place.maxHeight }} data-own-escape onKeyDown={(event) => {
      const items = [...list.current!.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)')];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        items[index < 0 ? 0 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'Tab') close();
    }}>
      <div className="gallery-filter-menu-head">
        <strong>{label}</strong>
        <button type="button" className="gallery-filter-clear" disabled={enabled.every((option) => values.includes(option.value))} onClick={() => onChange([...new Set([...values, ...enabled.map((option) => option.value)])])}>All</button>
        <button type="button" className="gallery-filter-clear" disabled={!values.length} onClick={() => onChange([])}>Clear</button>
      </div>
      {searchable ? <div className="gallery-filter-search"><Search size={14} aria-hidden="true" /><input aria-label={`Search ${label}`} placeholder="Search" value={query} autoComplete="off" spellCheck={false} onChange={(event) => setQuery(event.target.value.slice(0, 100))} />{query ? <button type="button" aria-label="Clear Search" onClick={() => setQuery('')}><X size={12} /></button> : null}</div> : null}
      <div id={id} ref={list} className="gallery-filter-options" role="listbox" aria-multiselectable="true" aria-label={label}>
        {matches.map((option) => {
          const on = values.includes(option.value);
          return <button type="button" key={option.value} role="option" tabIndex={-1} aria-selected={on} disabled={option.disabled} title={option.disabled ? option.reason : option.detail} className={cn('aspect-option gallery-filter-option multi-select-option', on && 'active')} onClick={() => toggle(option.value)}>
            <span className="gallery-filter-check" aria-hidden="true">{on ? <Check size={12} strokeWidth={2.5} /> : null}</span>
            <span className="multi-select-text"><span>{option.label}</span>{option.disabled && option.reason ? <small>{option.reason}</small> : option.detail ? <small>{option.detail}</small> : null}</span>
          </button>;
        })}
        {!matches.length ? <EmptyState title={query ? 'No Matches' : 'Nothing to Choose Yet'} compact /> : null}
      </div>
    </div>, host) : null}
  </>;
}
