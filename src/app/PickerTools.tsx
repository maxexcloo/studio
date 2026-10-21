import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, Search } from 'lucide-react';
import { tweens, useMotionTween } from '@/lib/springs';
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
 * The phone heading's views on the shared Dropdown: the title stays plain text
 * and only the view is the trigger ("LoRAs · [This Model ▾]"). One view at a
 * time, or (`multi`) filters that combine, ticked, with the menu staying open.
 * The menu is as wide as its options, not the screen.
 */
function ViewsDropdown({ views, title }: { views: PickerViews; title: string }) {
  const options = views.options.map((option) => ({ value: option.id, label: option.label, ariaLabel: option.ariaLabel, disabled: option.disabled }));
  const run = (id: string | undefined) => views.options.find((option) => option.id === id)?.onSelect();
  const summary = <span className="picker-view-label"><span>{views.current}</span></span>;
  const checked = views.options.filter((option) => option.checked).map((option) => option.id);
  const menu = views.multi
    ? <Dropdown multiple head={false} variant="heading" fitMenu className="picker-view" label={views.label} summary={summary} options={options} value={checked} searchFrom={Infinity} onChange={(next) => run([...next.filter((id) => !checked.includes(id)), ...checked.filter((id) => !next.includes(id))][0])} />
    : <Dropdown variant="heading" fitMenu className="picker-view" label={views.label} summary={summary} options={options} value={checked[0] || ''} searchFrom={Infinity} onChange={run} />;
  return title ? <span className="picker-view-title"><strong>{title}</strong><span aria-hidden="true">·</span>{menu}</span> : menu;
}

export type PickerViewOption = { id: string; label: string; checked: boolean; disabled?: boolean; onSelect: () => void; ariaLabel?: string };
/**
 * The chooser's views as data, for the phone's heading dropdown: what is shown
 * now ("This Model") and every option. `multi` keeps the menu open on a choice
 * (filters that combine, such as Favourites with Fast).
 */
export type PickerViews = { label: string; current: string; options: PickerViewOption[]; multi?: boolean };

/**
 * One compact controls row; search takes space only when requested. Its icon
 * stays where it is, pressed while the field is open, and pressing it again
 * clears and folds the search. On the desktop heading the icon follows the
 * views and the field opens right after it (`inline`), or drops down under the
 * heading (`row`, the model chooser). In a phone pop-up the row moves into the
 * heading: the views as a dropdown after the title, Clear and the search icon,
 * with the field dropping down under the heading.
 */
export function PickerTools({ children, extra, clear, onClear, search, query, onClearSearch, onType, searchLabel, className, views, viewsMenu = false, searchMode = 'inline' }: {
  children: React.ReactNode;
  /** More heading controls after search (the LoRA Stacks dropdown). */
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
  /** Desktop heading search: `inline` opens right of the icon, after the views; `row` drops down under the heading. */
  searchMode?: 'inline' | 'row';
}) {
  const [open, setOpen] = React.useState(false);
  const expanded = open || Boolean(query);
  const id = React.useId();
  const root = React.useRef<HTMLDivElement>(null);
  const heading = useSurfaceHeading();
  const grow = useMotionTween(tweens.slow);
  const reduced = useReducedMotion();
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
  // The focus stays on the icon either way: it is still there, pressed or not.
  const toggle = () => {
    if (expanded) { setOpen(false); onClearSearch(); }
    else { setOpen(true); focusSearch(); }
  };
  const toggleButton = search ? <button type="button" className={cn('picker-search-toggle', expanded && 'is-on')} aria-label={searchLabel} aria-pressed={expanded} aria-controls={expanded ? id : undefined} onClick={toggle}><Search size={16} /></button> : null;
  // The field drops down under the heading or toolbar and folds back up (framer height at --motion-slow).
  const row = <AnimatePresence initial={false}>
    {search && expanded ? <motion.div key="search" className="picker-search-slot" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={grow}>
      <div id={id} className="picker-search-row">{search}</div>
    </motion.div> : null}
  </AnimatePresence>;

  if (phoneHeading && views) {
    return <div ref={root} className={cn('picker-tools is-heading', className)}>
      <HeadingPortal>
        <ViewsDropdown views={views} title={heading!.title} />
        {extra}
        {onClear ? <button type="button" className="picker-heading-clear" aria-label="Clear Selection" onClick={onClear}>Clear</button> : null}
        {toggleButton}
      </HeadingPortal>
      {row}
    </div>;
  }

  if (inHeading) {
    // The desktop heading: the views · the search icon (and its field) · Stacks · Clear, then Close.
    return <div ref={root} className={cn('picker-tools is-heading', className)}>
      <HeadingPortal>
        <div className={cn('picker-heading-tools', expanded && searchMode === 'inline' && 'is-searching')}>
          {viewsMenu && views ? <ViewsDropdown views={views} title="" /> : <div className="picker-controls">{children}</div>}
          {toggleButton}
          <AnimatePresence initial={false}>
            {search && expanded && searchMode === 'inline' ? <motion.div key="search" id={id} className="picker-search-field is-inline" initial={{ opacity: 0, scaleX: reduced ? 1 : 0.96 }} animate={{ opacity: 1, scaleX: 1 }} exit={{ opacity: 0, transition: tweens.fast }} transition={tweens.fast}>{search}</motion.div> : null}
          </AnimatePresence>
          {extra}
          {onClear ? <button type="button" className="picker-heading-clear" aria-label="Clear Selection" onClick={onClear}>Clear</button> : clear}
        </div>
      </HeadingPortal>
      {searchMode === 'row' ? row : null}
    </div>;
  }

  return <div ref={root} className={cn('picker-tools', expanded && 'is-searching', className)}>
    <div className="picker-toolbar">
      <div className="picker-controls">{children}</div>
      {extra}
      {clear}
      {toggleButton}
    </div>
    {row}
  </div>;
}
