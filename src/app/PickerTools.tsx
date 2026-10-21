import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { cn } from './format';
import { useDismiss } from './useDismiss';
import { popoverMotion, useSettling } from './composerSurface';

/**
 * The one selected mark in every chooser (UI-PATTERNS › Pickers): an amber
 * tick at the end of the row, the same icon, size and stroke everywhere. An
 * unpicked row keeps the space (`on={false}`) so names never shift.
 */
export function SelectedTick({ on = true, className }: { on?: boolean; className?: string }) {
  return <Check size={16} strokeWidth={2.5} className={cn('selected-tick', !on && 'is-off', className)} aria-hidden="true" />;
}

/* ------------------------------------------------------------- Heading */

type SurfaceHeading = { slot: HTMLElement | null; title: string; phone: boolean };

/**
 * A picker surface's heading row (its title, then Close) lends a slot to what
 * it hosts: the Stacks dropdown on both devices and, on the phone, the view
 * dropdown, Clear and the search toggle, so the list starts right under it.
 */
export const SurfaceHeadingContext = React.createContext<SurfaceHeading | null>(null);

export function useSurfaceHeading() {
  return React.useContext(SurfaceHeadingContext);
}

/** The heading's slot element and the context value to provide under it. */
export function useSurfaceHeadingSlot(title: string, phone: boolean) {
  const [slot, setSlot] = React.useState<HTMLElement | null>(null);
  const value = React.useMemo(() => ({ slot, title, phone }), [slot, title, phone]);
  return { ref: setSlot, value };
}

/** Renders into the surrounding surface's heading slot; nothing outside a surface. */
export function HeadingPortal({ children }: { children: React.ReactNode }) {
  const heading = useSurfaceHeading();
  return heading?.slot ? createPortal(children, heading.slot) : null;
}

/* ------------------------------------------------------------ Dropdown */

/**
 * A small menu under a heading trigger: the shared popover entry, rows of
 * --row-h-menu (44 px on touch) with the amber tick for what is chosen, arrow
 * keys between rows, Escape or a tap outside to close, focus back on the
 * trigger. `children` gets `close` for rows that finish the job.
 */
export function PickerDropdown({ label, trigger, triggerLabel, className, children }: {
  /** The menu's accessible name. */
  label: string;
  trigger: React.ReactNode;
  triggerLabel?: string;
  className?: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const root = React.useRef<HTMLDivElement>(null);
  const button = React.useRef<HTMLButtonElement>(null);
  const menu = React.useRef<HTMLDivElement>(null);
  const settling = useSettling();
  const close = React.useCallback(() => { setOpen(false); button.current?.focus({ preventScroll: true }); }, []);
  useDismiss(root, open, close);
  React.useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => (menu.current?.querySelector<HTMLElement>('[aria-checked="true"]:not(:disabled)') || menu.current?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled), input'))?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const onKeyDown = (event: React.KeyboardEvent) => {
    // Escape closes only this menu, not the picker around it (data-own-escape keeps useDismiss out of it).
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    if (event.target instanceof HTMLInputElement) return;
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') || []);
    if (!items.length) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next].focus({ preventScroll: true });
  };
  return <div ref={root} className={cn('picker-dropdown', className)} data-own-escape={open ? '' : undefined} onKeyDown={open ? onKeyDown : undefined}>
    <button ref={button} type="button" className="picker-dropdown-trigger" aria-haspopup="menu" aria-expanded={open} aria-label={triggerLabel} onClick={() => setOpen((value) => !value)}>
      {trigger}<ChevronDown size={14} aria-hidden="true" />
    </button>
    <AnimatePresence>
      {open ? <motion.div ref={menu} className="picker-dropdown-menu" role="menu" aria-label={label} {...popoverMotion} {...settling}>
        {children(close)}
      </motion.div> : null}
    </AnimatePresence>
  </div>;
}

/** One row in a PickerDropdown: a choice (with its tick) or an action. */
export function MenuRow({ checked, onSelect, disabled, danger, children, label }: { checked?: boolean; onSelect: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode; label?: string }) {
  const choice = checked !== undefined;
  return <button type="button" role={choice ? 'menuitemcheckbox' : 'menuitem'} aria-checked={choice ? checked : undefined} aria-label={label} disabled={disabled} className={cn('picker-menu-row', danger && 'is-danger')} onClick={onSelect}>
    <span className="picker-menu-label">{children}</span>
    {choice ? <SelectedTick on={checked} /> : null}
  </button>;
}

export function MenuDivider() {
  return <span className="picker-menu-divider" role="separator" />;
}

/* -------------------------------------------------------------- Tools */

export type PickerViewOption = { id: string; label: React.ReactNode; checked: boolean; disabled?: boolean; onSelect: () => void; ariaLabel?: string };
/**
 * The chooser's views as data, for the phone's heading dropdown: what is shown
 * now ("This Model") and every option. `multi` keeps the menu open on a choice
 * (filters that combine, such as Favourites with Fast).
 */
export type PickerViews = { label: string; current: string; options: PickerViewOption[]; multi?: boolean };

/**
 * One compact controls row; search takes space only when requested. On the
 * desktop the search icon grows into a field inside the same row, beside the
 * pills. In a phone pop-up the row moves into the heading: the views as a
 * dropdown after the title, Clear and the search icon, with the field opening
 * under the heading.
 */
export function PickerTools({ children, extra, clear, onClear, search, query, onClearSearch, onType, searchLabel, className, views }: {
  children: React.ReactNode;
  /** More heading controls after the views (the LoRA Stacks dropdown). */
  extra?: React.ReactNode;
  clear?: React.ReactNode;
  /** Clear Selection as an action, for the phone heading's compact Clear. */
  onClear?: () => void;
  search?: React.ReactNode;
  query: string;
  onClearSearch: () => void;
  /** Typing anywhere in the picker opens search with that character. */
  onType?: (key: string) => void;
  searchLabel: string;
  className?: string;
  views?: PickerViews;
}) {
  const [open, setOpen] = React.useState(false);
  const expanded = open || Boolean(query);
  const id = React.useId();
  const root = React.useRef<HTMLDivElement>(null);
  const heading = useSurfaceHeading();
  // In a surface with a heading the tools live in it; the phone needs the views as data for its dropdown.
  const inHeading = Boolean(heading?.slot && (views || !heading.phone));
  const phoneHeading = Boolean(inHeading && heading?.phone && views);
  const focusSearch = () => requestAnimationFrame(() => (root.current?.querySelector<HTMLInputElement>('.picker-search-row input') || heading?.slot?.querySelector<HTMLInputElement>('.picker-search-field input') || root.current?.querySelector<HTMLInputElement>('.picker-search-field input'))?.focus({ preventScroll: true }));
  React.useEffect(() => {
    const surface = root.current?.parentElement;
    if (!surface || !onType || !search) return;
    const type = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1 || event.key === ' ') return;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="menu"]')) return;
      event.preventDefault();
      setOpen(true);
      onType(event.key);
      focusSearch();
    };
    // The heading sits outside the body on the phone; typing there searches too.
    const scope = inHeading ? surface.closest<HTMLElement>('.reference-popover, .model-menu') || surface : surface;
    scope.addEventListener('keydown', type);
    return () => scope.removeEventListener('keydown', type);
  }, [onType, Boolean(search), inHeading]);
  const toggle = () => {
    if (expanded) { setOpen(false); onClearSearch(); }
    else {
      setOpen(true);
      focusSearch();
    }
  };
  const toggleButton = search ? <button type="button" className={cn('picker-search-toggle', query && 'is-active')} aria-label={expanded ? 'Close Search' : searchLabel} aria-expanded={expanded} aria-controls={id} onClick={toggle}>{expanded ? <X size={16} /> : <Search size={16} />}</button> : null;

  if (phoneHeading && views) {
    return <div ref={root} className={cn('picker-tools is-heading', className)}>
      <HeadingPortal>
        <PickerDropdown label={views.label} className="picker-view" trigger={<span className="picker-view-label"><strong>{heading!.title}</strong><span aria-hidden="true">·</span><span>{views.current}</span></span>}>
          {(close) => views.options.map((option) => <MenuRow key={option.id} checked={option.checked} disabled={option.disabled} label={option.ariaLabel} onSelect={() => { option.onSelect(); if (!views.multi) close(); }}>{option.label}</MenuRow>)}
        </PickerDropdown>
        {extra}
        {onClear ? <button type="button" className="picker-heading-clear" aria-label="Clear Selection" onClick={onClear}>Clear</button> : null}
        {toggleButton}
      </HeadingPortal>
      {search && expanded ? <div id={id} className="picker-search-row">{search}</div> : null}
    </div>;
  }

  if (inHeading) {
    // The desktop heading: title · the views · Clear · search, which grows leftwards from its icon, then Close.
    return <div ref={root} className={cn('picker-tools is-heading', className)}>
      <HeadingPortal>
        <div className={cn('picker-heading-tools', expanded && 'is-searching')}>
          <div className="picker-controls">{children}</div>
          {extra}
          {onClear ? <button type="button" className="picker-heading-clear" aria-label="Clear Selection" onClick={onClear}>Clear</button> : clear}
          {search && expanded ? <div id={id} className="picker-search-field">{search}</div> : null}
          {toggleButton}
        </div>
      </HeadingPortal>
    </div>;
  }

  return <div ref={root} className={cn('picker-tools', expanded && 'is-searching', className)}>
    <div className="picker-toolbar">
      <div className="picker-controls">{children}</div>
      {extra}
      {clear}
      {search && expanded ? <div id={id} className="picker-search-field">{search}</div> : null}
      {toggleButton}
    </div>
  </div>;
}
