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
 * time, like the desktop's pills. The menu is as wide as its options, not the screen.
 */
function ViewsDropdown({ views, title }: { views: PickerViews; title: string }) {
  const options = views.options.map((option) => ({ value: option.id, label: option.label, ariaLabel: option.ariaLabel, disabled: option.disabled }));
  const run = (id: string | undefined) => views.options.find((option) => option.id === id)?.onSelect();
  const summary = <span className="picker-view-label"><span>{views.current}</span></span>;
  const checked = views.options.find((option) => option.checked)?.id || '';
  const menu = <Dropdown variant="heading" fitMenu className="picker-view" label={views.label} summary={summary} options={options} value={checked} searchFrom={Infinity} onChange={run} />;
  return title ? <span className="picker-view-title"><strong>{title}</strong><span aria-hidden="true">·</span>{menu}</span> : menu;
}

export type PickerViewOption = { id: string; label: string; checked: boolean; disabled?: boolean; onSelect: () => void; ariaLabel?: string };
/** The chooser's views as data, for the phone's heading dropdown: what is shown now ("This Model") and every option. */
export type PickerViews = { label: string; current: string; options: PickerViewOption[] };

/**
 * One compact controls row; search takes space only when requested. On the
 * desktop heading (References, LoRAs, Models alike) the search icon follows the
 * views, and opening it swaps every heading control but the views and Close
 * (the icon, Stacks, Clear) for the field, in their place: the field's own
 * icon, pressed, is where the search icon was and folds it again. The views
 * and Close never move. In a phone pop-up the row moves into the heading: the
 * views as a dropdown after the title, Clear and the search icon, with the
 * field dropping down under the heading.
 */
export function PickerTools({ children, extra, clear, onClear, search, query, onClearSearch, onType, searchLabel, className, views }: {
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
    // The desktop heading: the views, then one swap area: the search icon · Stacks · Clear at rest. Searching,
    // the field fades in over the whole area with the icon (pressed) as its own, and the rest fades out and goes
    // inert but keeps its room, so the views and Close keep their place on every frame, opening and closing alike.
    const fade = reduced ? { duration: 0 } : tweens.fast;
    return <div ref={root} className={cn('picker-tools is-heading', className)}>
      <HeadingPortal>
        <div className={cn('picker-heading-tools', expanded && 'is-searching')}>
          <div className="picker-controls">{children}</div>
          <div className={cn('picker-heading-swap', expanded && Boolean(search) && 'is-searching')}>
            {toggleButton}
            <motion.div className="picker-heading-rest" initial={false} animate={{ opacity: expanded && search ? 0 : 1 }} transition={fade} inert={Boolean(expanded && search)}>
              {extra}
              {onClear ? <button type="button" className="picker-heading-clear" aria-label="Clear Selection" onClick={onClear}>Clear</button> : clear}
            </motion.div>
            <AnimatePresence initial={false}>
              {search && expanded ? <motion.div key="search" id={id} className="picker-search-field is-swap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}>{search}</motion.div> : null}
            </AnimatePresence>
          </div>
        </div>
      </HeadingPortal>
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
