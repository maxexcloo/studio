import React from 'react';
import { createPortal } from 'react-dom';
import { Check, Search, X } from 'lucide-react';
import { cn } from './format';
import { Dropdown } from './Dropdown';

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

/* -------------------------------------------------------------- Tools */

/**
 * The phone heading's views ("LoRAs · This Model") on the shared Dropdown:
 * one view at a time, or (`multi`) filters that combine, ticked, with the
 * menu staying open.
 */
function ViewsDropdown({ views, title }: { views: PickerViews; title: string }) {
  const options = views.options.map((option) => ({ value: option.id, label: option.label, ariaLabel: option.ariaLabel, disabled: option.disabled }));
  const run = (id: string | undefined) => views.options.find((option) => option.id === id)?.onSelect();
  const summary = title ? <span className="picker-view-label"><strong>{title}</strong><span aria-hidden="true">·</span><span>{views.current}</span></span> : <span className="picker-view-label"><span>{views.current}</span></span>;
  const checked = views.options.filter((option) => option.checked).map((option) => option.id);
  return views.multi
    ? <Dropdown multiple head={false} variant="heading" className="picker-view" label={views.label} summary={summary} options={options} value={checked} searchFrom={Infinity} onChange={(next) => run([...next.filter((id) => !checked.includes(id)), ...checked.filter((id) => !next.includes(id))][0])} />
    : <Dropdown variant="heading" className="picker-view" label={views.label} summary={summary} options={options} value={checked[0] || ''} searchFrom={Infinity} onChange={run} />;
}

export type PickerViewOption = { id: string; label: string; checked: boolean; disabled?: boolean; onSelect: () => void; ariaLabel?: string };
/**
 * The chooser's views as data, for the phone's heading dropdown: what is shown
 * now ("This Model") and every option. `multi` keeps the menu open on a choice
 * (filters that combine, such as Favourites with Fast).
 */
export type PickerViews = { label: string; current: string; options: PickerViewOption[]; multi?: boolean };

/**
 * One compact controls row; search takes space only when requested: its icon
 * drops the field down under the heading, the popover's full width. In a phone pop-up the row moves into the heading: the views as a
 * dropdown after the title, Clear and the search icon, with the field opening
 * under the heading.
 */
export function PickerTools({ children, extra, clear, onClear, search, query, onClearSearch, onType, searchLabel, className, views, viewsMenu = false, searchMode = 'cover' }: {
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
  /** On the desktop too, the views are one compact dropdown instead of pills (the model chooser). */
  viewsMenu?: boolean;
  /** Desktop heading search: `cover` fills the heading over the other controls; `row` drops down under it. */
  searchMode?: 'cover' | 'row';
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
  // Open search carries its own close inside the field; the heading icon only opens it.
  const closeInField = <button type="button" className="picker-search-close" aria-label="Close Search" onClick={toggle}><X size={14} /></button>;
  const field = (className: string) => <div id={id} className={className}>{search}{closeInField}</div>;
  const toggleButton = search && !expanded ? <button type="button" className={cn('picker-search-toggle', query && 'is-active')} aria-label={expanded ? 'Close Search' : searchLabel} aria-expanded={expanded} aria-controls={id} onClick={toggle}>{expanded ? <X size={16} /> : <Search size={16} />}</button> : null;

  if (phoneHeading && views) {
    return <div ref={root} className={cn('picker-tools is-heading', className)}>
      <HeadingPortal>
        <ViewsDropdown views={views} title={heading!.title} />
        {extra}
        {onClear ? <button type="button" className="picker-heading-clear" aria-label="Clear Selection" onClick={onClear}>Clear</button> : null}
        {toggleButton}
      </HeadingPortal>
      {search && expanded ? field('picker-search-row') : null}
    </div>;
  }

  if (inHeading) {
    // The desktop heading: title · the views · Clear · the search icon, then Close.
    return <div ref={root} className={cn('picker-tools is-heading', className)}>
      <HeadingPortal>
        <div className={cn('picker-heading-tools', expanded && 'is-searching')}>
          {expanded && search && searchMode === 'cover' ? field('picker-search-field is-cover') : <>
            {viewsMenu && views ? <ViewsDropdown views={views} title="" /> : <div className="picker-controls">{children}</div>}
            {extra}
            {onClear ? <button type="button" className="picker-heading-clear" aria-label="Clear Selection" onClick={onClear}>Clear</button> : clear}
            {toggleButton}
          </>}
        </div>
      </HeadingPortal>
      {/* Row mode: search drops down under the heading, the full popover width. */}
      {search && expanded && searchMode === 'row' ? field('picker-search-row') : null}
    </div>;
  }

  return <div ref={root} className={cn('picker-tools', expanded && 'is-searching', className)}>
    <div className="picker-toolbar">
      <div className="picker-controls">{children}</div>
      {extra}
      {clear}
      {toggleButton}
    </div>
    {search && expanded ? field('picker-search-row') : null}
  </div>;
}
