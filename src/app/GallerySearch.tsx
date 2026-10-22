import React from 'react';
import { createPortal } from 'react-dom';
import { Boxes, Eraser, ChevronDown, Layers, Ratio, Ruler, Search, SlidersHorizontal, Star, X } from 'lucide-react';
import { galleryAspects, gallerySizeBands, otherAspect } from '../../server/gallery-filters.js';
import { loraName } from './catalogueNames';
import { partName } from './partNames';
import { cn } from './format';
import { useDismiss } from './useDismiss';
import type { GalleryItem } from './types';
import { searchFilterKeys, type GallerySearch } from './favorites';
import { SearchMark } from './SearchMark';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'framer-motion';
import { tweens, useMotionTween } from '@/lib/springs';
import { EmptyState } from './EmptyState';
import { Tip } from './components';
import { SelectedTick } from './PickerTools';
import { anchoredPlacement } from './composerSurface';

const sizeLabels = new Map(gallerySizeBands.map((band) => [band.id, `${band.label} (${band.detail})`]));
const aspectLabels = new Map([...galleryAspects.map((aspect) => [aspect.id, aspect.id] as const), [otherAspect, 'Other']]);
export const filterLabel = (key: 'size' | 'aspect', value?: string) => (value ? (key === 'size' ? sizeLabels : aspectLabels).get(value) || value : '');

/**
 * One multi-select filter: its trigger shows how many values are picked, its
 * menu toggles values (any of them matches) and has its own Clear.
 */
export function GalleryFilterPicker({ name, label = name, values: picked, options: values, icon: Icon, onChange, floatingRef, labelFor = (option) => option, searchable = true }: { name: string; label?: string; values: string[]; options: string[]; icon: typeof Boxes; onChange: (values: string[]) => void; floatingRef: React.RefObject<HTMLDivElement | null>; labelFor?: (value: string) => string; searchable?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [searchOpen, setSearchOpen] = React.useState(false);
  const searching = searchable && (searchOpen || Boolean(query));
  const grow = useMotionTween(tweens.slow);
  const searchInput = React.useRef<HTMLInputElement>(null);
  const [position, setPosition] = React.useState({ left: 0, top: 0, maxHeight: 280 });
  // The full list's height as it opened: a search never shrinks the menu.
  const [held, setHeld] = React.useState(0);
  React.useLayoutEffect(() => {
    if (!open) { if (held) setHeld(0); return; }
    const height = searching ? 0 : menu.current?.offsetHeight || 0;
    if (height && height !== held) setHeld(height);
  });
  const anchor = React.useRef<HTMLButtonElement>(null);
  const menu = React.useRef<HTMLDivElement>(null);
  const list = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  const close = React.useCallback(() => { setOpen(false); anchor.current?.focus({ preventScroll: true }); }, []);
  useDismiss([anchor, menu], open, close);
  const focusOption = React.useCallback((option?: HTMLButtonElement | null) => {
    if (!option || !list.current) return;
    option.focus({ preventScroll: true });
    const bounds = list.current.getBoundingClientRect();
    const row = option.getBoundingClientRect();
    if (row.top < bounds.top) list.current.scrollTop += row.top - bounds.top;
    else if (row.bottom > bounds.bottom) list.current.scrollTop += row.bottom - bounds.bottom;
  }, []);
  React.useLayoutEffect(() => {
    if (!open) return;
    const place = (event?: Event) => {
      // Scrolling options must never reposition or refocus the floating surface.
      if (event?.target instanceof Node && menu.current?.contains(event.target)) return;
      // The shared placement (UI-PATTERNS › Surfaces): a top bar's filter opens below its trigger, start-aligned.
      const at = anchoredPlacement(anchor.current!.getBoundingClientRect(), { width: 260, minHeight: 200, maxHeight: 320, prefer: 'below' });
      const top = at.upward ? Math.max(8, window.innerHeight - (at.bottom || 0) - at.maxHeight) : at.top || 0;
      const next = { left: at.left, top, maxHeight: at.maxHeight };
      setPosition(current => current.left === next.left && current.top === next.top && current.maxHeight === next.maxHeight ? current : next);
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); window.visualViewport?.removeEventListener('resize', place); };
  }, [open]);
  React.useEffect(() => {
    if (open) focusOption(list.current?.querySelector<HTMLButtonElement>('[role="option"]'));
  }, [open, focusOption]);
  const toggle = (value: string) => onChange(picked.includes(value) ? picked.filter((item) => item !== value) : [...picked, value]);
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = values.filter(option => terms.every(term => labelFor(option).toLocaleLowerCase().includes(term)));
  // The trigger shows the option's friendly name, never a raw file name (UI-PATTERNS › Lists).
  const short = (value: string) => labelFor(value).replace(/ \(.*\)$/, '');
  const summary = picked.length === 1 ? short(picked[0]) : label;
  return <>
    <Tip content={picked.length ? `${name}: ${picked.map(labelFor).join(', ')}` : `Filter By ${name}`}><button ref={anchor} type="button" className={cn('gallery-filter-select', picked.length > 0 && 'is-on')} aria-label={`Filter By ${name}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => { if (!open) { setQuery(''); setSearchOpen(false); } setOpen(!open); }} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setQuery(''); setOpen(true); } }}><Icon size={16} /><span>{summary}</span>{picked.length > 1 ? <em className="gallery-filter-count" aria-hidden="true">{picked.length}</em> : null}<ChevronDown size={12} /></button></Tip>
    {open ? createPortal(<div ref={node => { menu.current = node; floatingRef.current = node; }} className="aspect-menu gallery-filter-menu" style={{ ...position, minHeight: searching && held ? Math.min(held, position.maxHeight) : undefined }} data-own-escape onKeyDown={event => {
      const options = [...list.current!.querySelectorAll<HTMLButtonElement>('[role="option"]')];
      const index = options.indexOf(document.activeElement as HTMLButtonElement);
      const typing = event.target instanceof HTMLInputElement;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || (!typing && (event.key === 'Home' || event.key === 'End'))) {
        event.preventDefault();
        focusOption(options[event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : index < 0 ? (event.key === 'ArrowDown' ? 0 : options.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]);
      }
      if (typing && event.key === 'Enter' && matches.length) { event.preventDefault(); toggle(matches[0]); }
      if (searchable && !typing && event.key.length === 1 && event.key !== ' ' && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); setSearchOpen(true); setQuery((value) => (value + event.key).slice(0, 100)); requestAnimationFrame(() => searchInput.current?.focus({ preventScroll: true })); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
      <div className="gallery-filter-menu-head"><strong>{label}</strong>
        {/* Search sits right after the title and stays there, pressed while open; pressing it again clears and folds it (UI-PATTERNS › Dropdowns). Typing in the menu opens it too. */}
        {searchable ? <button type="button" className={cn('gallery-filter-search-toggle', searching && 'is-on')} aria-label={`Search ${label}`} aria-pressed={searching} onClick={() => { if (searching) { setSearchOpen(false); setQuery(''); } else { setSearchOpen(true); requestAnimationFrame(() => searchInput.current?.focus({ preventScroll: true })); } }}><Search size={14} /></button> : null}
        {picked.length ? <span>{picked.length} Selected</span> : null}
        <button type="button" className="gallery-filter-clear" disabled={!picked.length} onClick={() => onChange([])}>Clear</button></div>
      {/* The field drops down under the head and folds back up; the menu keeps the height the full list opened at. */}
      <AnimatePresence initial={false}>
        {searching ? <motion.div key="search" className="gallery-filter-search-slot" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={grow}>
          <div className="gallery-filter-search"><Search size={14} /><input ref={searchInput} aria-label={`Search ${label}`} placeholder="Search" value={query} autoComplete="off" spellCheck={false} onChange={event => { setQuery(event.target.value.slice(0, 100)); if (list.current) list.current.scrollTop = 0; }} />{query ? <button type="button" aria-label="Clear Search" onClick={() => { setQuery(''); searchInput.current?.focus({ preventScroll: true }); }}><X size={12} /></button> : null}</div>
        </motion.div> : null}
      </AnimatePresence>
      <div id={id} ref={list} className="gallery-filter-options" role="listbox" aria-multiselectable="true" aria-label={`${name} Filter`}>{matches.map(option => {
        const on = picked.includes(option);
        return <button type="button" key={option} className={cn('aspect-option gallery-filter-option', on && 'active')} role="option" tabIndex={-1} aria-selected={on} onClick={() => toggle(option)}><span className="gallery-filter-name">{labelFor(option)}</span><SelectedTick on={on} /></button>;
      })}{!matches.length ? <EmptyState title={query ? 'No Matches' : 'Nothing to Filter Yet'} compact /> : null}</div>
    </div>, document.body) : null}
  </>;
}

export const clearedSearch = (search: GallerySearch): GallerySearch => ({ ...search, q: '', favorites: false, workflow: '', ...Object.fromEntries(searchFilterKeys.map((key) => [key, []])) });
export const filterCountOf = (search: GallerySearch) => searchFilterKeys.filter((key) => search[key]?.length).length + Number(Boolean(search.workflow?.trim())) + Number(search.favorites);

/**
 * The gallery's filters, in one order on the desktop and phones: Starred,
 * Models, LoRAs, Size, Aspect Ratio (docs/guides/UI-PATTERNS.md). Values
 * within a filter combine with OR, filters with AND, over the whole gallery.
 */
function FilterControls({ search, setSearch, items, floatingRef, clearable }: { search: GallerySearch; setSearch: (next: GallerySearch) => void; items: GalleryItem[]; floatingRef: React.RefObject<HTMLDivElement | null>; clearable?: boolean }) {
  const suggestions = (values: unknown[]) => [...new Set(values.flatMap((value) => typeof value === 'string' && value ? [value] : []))].sort((a, b) => a.localeCompare(b));
  const options = {
    lora: items.flatMap((item) => (Array.isArray(item.settings?.loras) ? item.settings.loras : []).map((lora) => lora.name)),
    model: items.flatMap((item) => [item.model, item.settings?.modelName]),
  };
  const count = filterCountOf(search);
  return <>
    <Tip content={"Only Starred"}><button type="button" className={cn('gallery-filter-select', search.favorites && 'is-on')} aria-pressed={search.favorites} onClick={() => setSearch({ ...search, favorites: !search.favorites })}><Star size={16} fill={search.favorites ? 'currentColor' : 'none'} /><span>Starred</span></button></Tip>
    {(['model', 'lora'] as const).map((key) => {
      const name = key === 'lora' ? 'LoRA' : 'Model';
      const Icon = key === 'model' ? Boxes : Layers;
      return <GalleryFilterPicker key={key} name={name} label={key === 'lora' ? 'LoRAs' : 'Models'} labelFor={(value) => (/\.[a-z0-9]{2,12}$/i.test(value) || value.includes('/') ? (key === 'lora' ? loraName(value) : partName(value.replace(/^custom:/, ''))) : value)} values={search[key] || []} options={suggestions([...(search[key] || []), ...options[key]])} icon={Icon} onChange={values => setSearch({ ...search, [key]: values })} floatingRef={floatingRef} />;
    })}
    <GalleryFilterPicker name="Size" values={search.size || []} options={gallerySizeBands.map((band) => band.id)} icon={Ruler} labelFor={(value) => filterLabel('size', value)} searchable={false} onChange={values => setSearch({ ...search, size: values })} floatingRef={floatingRef} />
    <GalleryFilterPicker name="Aspect Ratio" values={search.aspect || []} options={[...galleryAspects.map((aspect) => aspect.id), otherAspect]} icon={Ratio} labelFor={(value) => filterLabel('aspect', value)} searchable={false} onChange={values => setSearch({ ...search, aspect: values })} floatingRef={floatingRef} />
    {clearable && count ? <Tip content={"Clear Filters"}><button type="button" className="gallery-filter-icon" aria-label="Clear Filters" onClick={() => setSearch({ ...clearedSearch(search), q: search.q })}><X size={16} /></button></Tip> : null}
  </>;
}

// A dialog on top owns the keyboard (the viewer counts: it is a dialog too).
const OPEN_DIALOG = '[role="dialog"], [role="alertdialog"]';

export function useGallerySearchKeys(enabled: boolean, open: () => void) {
  const openRef = React.useRef(open);
  openRef.current = open;
  React.useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || document.querySelector(OPEN_DIALOG)) return;
      const findKey = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f';
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing = Boolean(target?.closest("input, textarea, select, [contenteditable='true']"));
      const slash = event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !typing;
      if (!findKey && !slash) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openRef.current();
    };
    // Capture, so it runs before "typing anywhere goes to the prompt".
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [enabled]);
}

type SearchProps = {
  search: GallerySearch;
  setSearch: (next: GallerySearch) => void;
  /** How many match, when that is known. */
  count?: number;
  open: boolean;
  setOpen: (open: boolean) => void;
  filterTriggerRef?: React.RefObject<HTMLElement | null>;
  /** The button outside the bar that toggles search, so pressing it is not an outside click. */
  searchTriggerRef?: React.RefObject<HTMLElement | null>;
  filtersOpen?: boolean;
  setFiltersOpen?: (open: boolean) => void;
};

export function GallerySearchBar({ search, setSearch, open, setOpen, filterTriggerRef, searchTriggerRef, filtersOpen: controlledFiltersOpen, setFiltersOpen: controlledSetFiltersOpen, items = [] }: SearchProps & { items?: GalleryItem[] }) {
  const present = useIsPresent();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const toolsRef = React.useRef<HTMLDivElement>(null);
  const floatingRef = React.useRef<HTMLDivElement>(null);
  const filterControlsRef = React.useRef<HTMLDivElement>(null);
  const [filterHeight, setFilterHeight] = React.useState(0);
  const [localFiltersOpen, setLocalFiltersOpen] = React.useState(false);
  const filterCount = filterCountOf(search);
  const filterActive = filterCount > 0;
  const queryActive = Boolean(search.q.trim());
  const active = queryActive || filterActive;
  // An active search or filter stays open.
  const searchExpanded = open || queryActive;
  const filtersRequested = controlledFiltersOpen ?? localFiltersOpen;
  const filtersOpen = filtersRequested || filterActive;
  const setFiltersOpen = controlledSetFiltersOpen ?? setLocalFiltersOpen;
  // An open filter menu takes the outside tap or Escape for itself.
  const closeFilters = React.useCallback(() => { if (!floatingRef.current?.isConnected) setFiltersOpen(false); }, [setFiltersOpen]);
  const closeSearch = React.useCallback(() => {
    if (floatingRef.current?.isConnected) return;
    setOpen(false);
  }, [setOpen]);
  const reducedMotion = useReducedMotion();
  const triggers = [filterTriggerRef || toolsRef, searchTriggerRef || toolsRef];
  useDismiss([toolsRef, floatingRef, ...triggers], filtersOpen && !filterActive, closeFilters);
  useDismiss([toolsRef, floatingRef, ...triggers], open && !queryActive, closeSearch);
  React.useEffect(() => {
    if (filterActive && !filtersRequested) setFiltersOpen(true);
  }, [filterActive, filtersRequested, setFiltersOpen]);
  React.useLayoutEffect(() => {
    const controls = filterControlsRef.current;
    if (!controls) { setFilterHeight(0); return; }
    const measure = () => {
      const height = controls.getBoundingClientRect().height + 8;
      setFilterHeight(height);
      toolsRef.current?.closest<HTMLElement>('.gallery-toolbar')?.style.setProperty('--gallery-filter-row-h', `${height}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(controls);
    return () => observer.disconnect();
  }, [filtersOpen]);
  const id = React.useId();
  React.useEffect(() => {
    if (open) { inputRef.current?.focus({ preventScroll: true }); inputRef.current?.select(); }
  }, [open]);
  return <motion.div ref={toolsRef} className={cn('gallery-search-tools', active && 'is-active')} style={{ '--gallery-filter-row-h': `${filterHeight}px` } as React.CSSProperties} role="search" data-open-surface aria-hidden={!present || undefined} inert={!present} initial={false} animate={{ opacity: 1 }} transition={reducedMotion ? { duration: 0 } : tweens.fast}>
    {/* The field opens and folds at --motion-base (the one width that animates, UI-PATTERNS › Motion); instant with reduced motion. */}
    <motion.div className={cn('gallery-search', searchExpanded && 'is-expanded')} initial={false} animate={{ width: searchExpanded ? 220 : 48 }} transition={reducedMotion ? { duration: 0 } : tweens.base}>
      <Tip content={"Search"}><button type="button" className="gallery-search-trigger" aria-label="Search Gallery" aria-expanded={searchExpanded} aria-controls={`${id}-query`} onClick={() => { setOpen(!open); if (queryActive) inputRef.current?.focus({ preventScroll: true }); }}><Search size={16} /></button></Tip>
      <motion.div className="gallery-search-field" aria-hidden={!searchExpanded || !present} initial={false} animate={{ opacity: searchExpanded && present ? 1 : 0 }} transition={reducedMotion ? { duration: 0 } : tweens.fast}>
        <input id={`${id}-query`} ref={inputRef} value={search.q} disabled={!searchExpanded || !present} tabIndex={searchExpanded && present ? 0 : -1} onChange={(event) => setSearch({ ...search, q: event.target.value.slice(0, 200) })}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!queryActive) setOpen(false); event.currentTarget.blur(); }
            if (event.key === 'Enter') event.currentTarget.blur();
          }} placeholder="Search" aria-label="Search Gallery" spellCheck={false} autoComplete="off" enterKeyHint="search" />
      </motion.div>
      {searchExpanded ? <Tip content={"Clear Search & Close"}><button type="button" className="gallery-query-close" aria-label="Clear Search" onClick={() => { setSearch({ ...search, q: '' }); setOpen(false); }}><X size={14} /></button></Tip> : null}
    </motion.div>
    <motion.div className={cn('gallery-filter-anchor', filtersOpen && 'is-expanded')}>
      <Tip content={"Filters"}><button type="button" className={cn('gallery-filter-trigger', filterCount > 0 && 'is-on')} aria-label="Gallery Filters" aria-expanded={filtersOpen} aria-controls={`${id}-filters`} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={16} /><span className="gallery-filter-label">Filters</span></button></Tip>
      <AnimatePresence initial={false}>
        {/* The filters open and fold as the search does: their width at --motion-base while they fade; instant with reduced motion. */}
        {filtersOpen ? <motion.div id={`${id}-filters`} className="gallery-filter-panel" role="group" aria-label="Gallery Filters" initial={reducedMotion ? false : { width: 0, opacity: 0 }} animate={{ width: 'auto', opacity: 1 }} exit={reducedMotion ? { opacity: 0 } : { width: 0, opacity: 0 }} transition={reducedMotion ? { duration: 0 } : { width: tweens.base, opacity: tweens.fast }}>
          <div className="gallery-filter-controls" ref={filterControlsRef}>
          <FilterControls search={search} setSearch={setSearch} items={items} floatingRef={floatingRef} clearable />
          </div>
        </motion.div> : null}
      </AnimatePresence>
    </motion.div>
  </motion.div>;
}

/** What an empty result says, and the one way back. */
export function SearchEmpty({ search, onClear }: { search: GallerySearch; onClear: () => void }) {
  const words = search.q.trim() || [...(search.model || []), search.workflow, ...(search.lora || []), ...(search.size || []).map((value) => filterLabel('size', value)), ...(search.aspect || []).map((value) => filterLabel('aspect', value))].filter(Boolean).join(" · ");
  const onlyStars = search.favorites && !words;
  return (
    <section className="gallery">
      <div className="empty stage-empty search-empty" aria-live="polite">
        <div className="stage-mark"><SearchMark className="stage-layer" star={onlyStars} /></div>
        <div className="stage-copy">
          <h2>{onlyStars ? 'No Favourites Yet' : <>Nothing Matches “{words}”{search.favorites ? ' in Favourites' : ''}</>}</h2>
          <p>{onlyStars
            ? 'Star an image and it shows up here.'
            : 'Search covers prompts, models and LoRAs. Try fewer words.'}</p>
          <div className="empty-actions">
            <button type="button" className="reconnect-btn primary" onClick={onClear}><X size={14} /> {onlyStars ? 'Show Everything' : 'Clear Search'}</button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ Phone */

/**
 * The phone top bar's shared row (docs/guides/UI-PATTERNS.md): Search or the
 * filter row, full width under the bar's own row; the other stays an icon up
 * there, tinted with a count while it has something applied. Closing it, by
 * its X, its icon, Escape or starting Select, clears the query and every filter.
 */
export function PhoneGalleryTools({ expanded, search, setSearch, onClose, items = [], viewControls }: {
  expanded: '' | 'search' | 'filters';
  /** The gallery view controls (GalleryViewControls), after the filters and before Clear. */
  viewControls?: React.ReactNode;
  search: GallerySearch;
  setSearch: (next: GallerySearch) => void;
  onClose: () => void;
  items?: GalleryItem[];
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const floatingRef = React.useRef<HTMLDivElement>(null);
  const rowRef = React.useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  React.useEffect(() => {
    if (expanded === 'search') inputRef.current?.focus({ preventScroll: true });
  }, [expanded]);
  React.useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || floatingRef.current?.isConnected || document.querySelector(OPEN_DIALOG)) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded, onClose]);
  return <AnimatePresence initial={false}>
    {expanded ? <motion.div key="tools" ref={rowRef} className={cn('phone-tools-row', `is-${expanded}`)} role="search" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={reducedMotion ? { duration: 0 } : tweens.base}>
      <div className="phone-tools-inner">
        {expanded === 'search' ? <label className="phone-tools-field">
          <Search size={17} aria-hidden="true" />
          <input ref={inputRef} value={search.q} onChange={(event) => setSearch({ ...search, q: event.target.value.slice(0, 200) })} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} placeholder="Search" aria-label="Search Gallery" spellCheck={false} autoComplete="off" enterKeyHint="search" />
          {/* Close sits inside the field, at its end: it clears the words and closes the row. */}
          <button type="button" className="phone-tools-close" aria-label="Clear Search" title="Clear & Close" onClick={(event) => { event.preventDefault(); onClose(); }}><X size={18} /></button>
        </label> : <div className="phone-filter-row gallery-filter-controls" role="group" aria-label="Gallery Filters">
          <FilterControls search={search} setSearch={setSearch} items={items} floatingRef={floatingRef} />
          {viewControls ? <span className="phone-filter-divider" aria-hidden="true" /> : null}
          {viewControls}
          {/* Clear ends the row, in the filters' own style: it clears them all and closes the row. */}
          <button type="button" className="gallery-filter-select phone-filter-clear" aria-label="Clear Filters" aria-description="Clears every filter and closes the row" onClick={onClose}><Eraser size={18} aria-hidden="true" /></button>
        </div>}
      </div>
    </motion.div> : null}
  </AnimatePresence>;
}
