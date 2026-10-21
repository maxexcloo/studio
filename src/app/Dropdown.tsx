import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Search, X } from 'lucide-react';
import { cn } from './format';
import { useDismiss } from './useDismiss';
import { anchoredPlacement, popoverMotion, useSettling, type AnchoredPlacement } from './composerSurface';
import { SelectedTick } from './PickerTools';
import { EmptyState } from './EmptyState';

export type DropdownOption = {
  value: string;
  label: string;
  /** A muted second line (a file name, a size). */
  detail?: string;
  disabled?: boolean;
  /** Why it is disabled, shown under its name. */
  reason?: string;
};

type Common = {
  /** The accessible name of the trigger and the menu. */
  label: string;
  options: DropdownOption[];
  disabled?: boolean;
  /** `row`: the value muted at the end of a list row; `pill`: a compact toolbar pill; `field`: a filled control. */
  variant?: 'row' | 'pill' | 'field';
  /** What the trigger shows instead of the picked option's name. */
  summary?: React.ReactNode;
  placeholder?: string;
  className?: string;
  /** The menu offers a search field from this many options. */
  searchFrom?: number;
};

type Single = Common & { value: string; onChange: (value: string) => void; multiple?: false };
type Multiple = Common & { value: string[]; onChange: (values: string[]) => void; multiple: true; allLabel?: string; noneLabel?: string; onAll?: () => void; allPicked?: boolean };

export type DropdownProps = Single | Multiple;

const ROW = 38;
const ROW_TOUCH = 44;

/**
 * The one dropdown (UI-PATTERNS › Dropdowns), on the desktop and the phone: a
 * trigger with the value and a chevron, and a menu in the shared popover
 * placement and motion, its rows ticked in amber for what is chosen. Arrow keys,
 * Home and End move between rows, typing jumps to a name, Enter or Space picks,
 * Escape or a click outside closes, and the focus returns to the trigger.
 * `multiple` keeps the menu open and ticks several, with All and Clear.
 */
export function Dropdown(props: DropdownProps) {
  const { label, options, disabled, variant = 'field', summary, placeholder = 'Not Set', className, searchFrom = 12 } = props;
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const trigger = React.useRef<HTMLButtonElement>(null);
  const menu = React.useRef<HTMLDivElement>(null);
  const list = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  const close = React.useCallback(() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }, []);
  useDismiss([trigger, menu], open, close);

  const picked = props.multiple ? props.value : [props.value];
  const isPicked = (value: string) => picked.includes(value);
  const labelOf = (value: string) => options.find((option) => option.value === value)?.label || value;
  const enabled = options.filter((option) => !option.disabled);
  const shown = summary ?? (props.multiple
    ? !props.value.length ? props.noneLabel || 'None' : enabled.length > 1 && enabled.every((option) => props.value.includes(option.value)) ? props.allLabel || 'All' : props.value.length === 1 ? labelOf(props.value[0]) : `${props.value.length} Selected`
    : props.value ? labelOf(props.value) : placeholder);
  const searchable = options.length >= searchFrom;
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = terms.length ? options.filter((option) => terms.every((term) => `${option.label} ${option.detail || ''}`.toLocaleLowerCase().includes(term))) : options;

  const choose = (value: string) => {
    if (props.multiple) props.onChange(props.value.includes(value) ? props.value.filter((item) => item !== value) : [...props.value, value]);
    else { if (value !== props.value) props.onChange(value); close(); }
  };

  // Type-ahead: letters typed in quick succession jump to the first name that starts with them.
  const typed = React.useRef({ text: '', at: 0 });
  const onKeyDown = (event: React.KeyboardEvent) => {
    const items = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') || []);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const inField = event.target instanceof HTMLInputElement;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || ((event.key === 'Home' || event.key === 'End') && !inField)) {
      event.preventDefault();
      if (!items.length) return;
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (at + 1) % items.length : at < 0 ? items.length - 1 : (at - 1 + items.length) % items.length;
      items[next].focus({ preventScroll: true });
      items[next].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === 'Tab') { setOpen(false); return; }
    if (!inField && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && event.key !== ' ') {
      const now = performance.now();
      typed.current = { text: (now - typed.current.at < 600 ? typed.current.text : '') + event.key.toLocaleLowerCase(), at: now };
      const hit = items.find((item) => (item.dataset.label || '').toLocaleLowerCase().startsWith(typed.current.text));
      if (hit) { event.preventDefault(); hit.focus({ preventScroll: true }); hit.scrollIntoView({ block: 'nearest' }); }
    }
  };

  return <>
    <button
      ref={trigger}
      type="button"
      className={cn('dropdown-trigger', `is-${variant}`, className)}
      disabled={disabled}
      role="combobox"
      aria-label={label}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? id : undefined}
      data-open-trigger
      onClick={() => { if (!open) setQuery(''); setOpen((value) => !value); }}
      onKeyDown={(event) => { if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); setQuery(''); setOpen(true); } }}
    >
      <span className="dropdown-value">{shown}</span>
      <ChevronDown size={14} aria-hidden="true" />
    </button>
    <AnimatePresence>
      {open ? <DropdownSurface key="menu" ref={menu} trigger={trigger.current} rows={matches.length + (searchable ? 1 : 0) + (props.multiple ? 1 : 0)} onKeyDown={onKeyDown}>
        {props.multiple ? <div className="dropdown-head">
          <strong>{label}</strong>
          <button type="button" className="dropdown-head-action" disabled={props.allPicked ?? enabled.every((option) => props.value.includes(option.value))} onClick={() => props.onAll ? props.onAll() : props.onChange([...new Set([...props.value, ...enabled.map((option) => option.value)])])}>All</button>
          <button type="button" className="dropdown-head-action" disabled={!props.value.length} onClick={() => props.onChange([])}>Clear</button>
        </div> : null}
        {searchable ? <div className="dropdown-search"><Search size={14} aria-hidden="true" /><input aria-label={`Search ${label}`} placeholder="Search" value={query} autoComplete="off" spellCheck={false} onChange={(event) => setQuery(event.target.value.slice(0, 100))} />{query ? <button type="button" aria-label="Clear Search" onClick={() => setQuery('')}><X size={12} /></button> : null}</div> : null}
        <div id={id} ref={list} className="dropdown-options" role="listbox" aria-label={label} aria-multiselectable={props.multiple || undefined}>
          {matches.map((option) => {
            const on = isPicked(option.value);
            const note = option.disabled && option.reason ? option.reason : option.detail;
            const noteId = note ? `${id}-${option.value}` : undefined;
            return <button key={option.value} type="button" role="option" tabIndex={-1} aria-selected={on} aria-label={option.label} aria-describedby={noteId} data-label={option.label} disabled={option.disabled} className={cn('dropdown-option', on && 'is-selected')} onClick={() => choose(option.value)}>
              <span className="dropdown-option-text"><span>{option.label}</span>{note ? <small id={noteId}>{note}</small> : null}</span>
              <SelectedTick on={on} />
            </button>;
          })}
          {!matches.length ? <EmptyState title={query ? 'No Matches' : 'Nothing to Choose Yet'} compact /> : null}
        </div>
      </DropdownSurface> : null}
    </AnimatePresence>
  </>;
}

/**
 * The menu's surface: portalled into the modal it sits in (a modal ignores
 * clicks and focus outside itself) or the page, placed by anchoredPlacement
 * at its trigger, and on a phone the pop-up list's width.
 */
const DropdownSurface = React.forwardRef<HTMLDivElement, { trigger: HTMLElement | null; rows: number; onKeyDown: (event: React.KeyboardEvent) => void; children: React.ReactNode }>(function DropdownSurface({ trigger, rows, onKeyDown, children }, ref) {
  const settling = useSettling();
  const [place, setPlace] = React.useState<(AnchoredPlacement & { offsetLeft: number; offsetTop: number; offsetBottom: number }) | null>(null);
  // A modal ignores clicks and focus outside itself, so the menu joins it; elsewhere (a popover
  // that clips its overflow) it goes to the page.
  const host = React.useMemo(() => trigger?.closest<HTMLElement>('.modal, [aria-modal="true"]') || document.body, [trigger]);
  React.useLayoutEffect(() => {
    if (!trigger) return;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const measure = () => {
      const rect = trigger.getBoundingClientRect();
      const phone = coarse && window.innerWidth <= 640;
      const height = Math.min(360, rows * (coarse ? ROW_TOUCH : ROW) + 12);
      // A phone's pop-up list spans the screen less a margin; the desktop's menu is at least its trigger's width.
      const placement = anchoredPlacement(rect, phone ? { width: window.innerWidth, minHeight: height, maxHeight: 420 } : { width: Math.max(rect.width, 240), minWidth: 200, maxWidth: 420, minHeight: height, maxHeight: 360 });
      // A transformed dialog is the containing block of fixed children.
      // A transformed or filtered host is the containing block of fixed children.
      const style = host !== document.body ? getComputedStyle(host) : null;
      const contains = style && (style.transform !== 'none' || style.filter !== 'none' || (style.backdropFilter && style.backdropFilter !== 'none') || style.perspective !== 'none' || /transform|filter/.test(style.willChange) || /paint|layout|strict|content/.test(style.contain));
      const box = contains ? host.getBoundingClientRect() : null;
      setPlace({ ...placement, offsetLeft: box?.left || 0, offsetTop: box?.top || 0, offsetBottom: box ? window.innerHeight - box.bottom : 0 });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [trigger, rows, host]);
  // Opening puts the focus on the picked row (else the first, or the search field).
  React.useEffect(() => {
    if (!place) return;
    const surface = (ref as React.RefObject<HTMLDivElement | null>).current;
    const target = surface?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]:not(:disabled)') || surface?.querySelector<HTMLElement>('.dropdown-search input, [role="option"]:not(:disabled)');
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest' });
  }, [Boolean(place)]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!place) return null;
  const style: React.CSSProperties = {
    left: place.left - place.offsetLeft,
    width: place.width,
    maxHeight: place.maxHeight,
    transformOrigin: place.transformOrigin,
    ...(place.upward ? { bottom: (place.bottom || 0) - place.offsetBottom } : { top: (place.top || 0) - place.offsetTop }),
  };
  return createPortal(<motion.div ref={ref} className="dropdown-menu" style={style} data-open-surface data-own-escape onKeyDown={onKeyDown} {...popoverMotion} {...settling}>{children}</motion.div>, host);
});
