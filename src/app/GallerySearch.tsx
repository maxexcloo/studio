import React from 'react';
import { createPortal } from 'react-dom';
import { Boxes, ChevronDown, Eye, EyeOff, Layers, Search, SlidersHorizontal, Star, X } from 'lucide-react';
import { cn } from './format';
import { useDismiss } from './useDismiss';
import type { GalleryItem } from './types';
import { emptySearch, searchActive, type GallerySearch } from './favorites';
import { SearchMark } from './SearchMark';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'framer-motion';
import { springs } from '@/lib/springs';

function GalleryFilterPicker({ name, value, values, icon: Icon, onChange, floatingRef }: { name: string; value: string; values: string[]; icon: typeof Boxes; onChange: (value: string) => void; floatingRef: React.RefObject<HTMLDivElement | null> }) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [position, setPosition] = React.useState({ left: 0, top: 0, maxHeight: 240 });
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
      const rect = anchor.current!.getBoundingClientRect();
      const viewport = window.visualViewport;
      const bottom = (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight);
      const viewportTop = viewport?.offsetTop || 0;
      const below = bottom - rect.bottom - 16;
      const above = rect.top - viewportTop - 16;
      const height = Math.max(0, Math.min(240, bottom - viewportTop - 16, Math.max(below, above)));
      const next = { left: Math.max(8, Math.min(rect.left, window.innerWidth - 248)), top: below >= Math.min(180, above) ? rect.bottom + 8 : Math.max(viewportTop + 8, rect.top - height - 8), maxHeight: height };
      setPosition(current => current.left === next.left && current.top === next.top && current.maxHeight === next.maxHeight ? current : next);
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); window.visualViewport?.removeEventListener('resize', place); };
  }, [open]);
  React.useEffect(() => {
    if (open) focusOption(list.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]'));
  }, [open, focusOption]);
  const choose = (next: string) => { onChange(next); close(); };
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = values.filter(option => terms.every(term => option.toLocaleLowerCase().includes(term)));
  return <>
    <button ref={anchor} type="button" className={cn('gallery-filter-select', value && 'is-on')} aria-label={`Filter By ${name}`} title={`${name}: ${value || 'Any'}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => { if (!open) setQuery(''); setOpen(!open); }} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setQuery(''); setOpen(true); } }}><Icon size={16} /><span>{value || name}</span><ChevronDown size={12} /></button>
    {open ? createPortal(<div ref={node => { menu.current = node; floatingRef.current = node; }} className="aspect-menu gallery-filter-menu" style={position} onKeyDown={event => {
      const options = [...list.current!.querySelectorAll<HTMLButtonElement>('[role="option"]')];
      const index = options.indexOf(document.activeElement as HTMLButtonElement);
      const typing = event.target instanceof HTMLInputElement;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || (!typing && (event.key === 'Home' || event.key === 'End'))) {
        event.preventDefault();
        focusOption(options[event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : index < 0 ? (event.key === 'ArrowDown' ? (terms.length && matches.length ? 1 : 0) : options.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]);
      }
      if (typing && event.key === 'Enter' && matches.length) { event.preventDefault(); choose(matches[0]); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
      <div className="gallery-filter-search"><Search size={14} /><input aria-label={`Search ${name === 'LoRA' ? 'LoRAs' : 'Models'}`} placeholder="Search" value={query} autoComplete="off" spellCheck={false} onChange={event => { setQuery(event.target.value.slice(0, 100)); if (list.current) list.current.scrollTop = 0; }} />{query ? <button type="button" aria-label="Clear Option Search" onClick={() => setQuery('')}><X size={12} /></button> : null}</div>
      <div id={id} ref={list} className="gallery-filter-options" role="listbox" aria-label={`${name} Filter`}>{['', ...matches].map(option => <button type="button" key={option} className={cn('aspect-option', option === value && 'active')} role="option" tabIndex={option === value ? 0 : -1} aria-selected={option === value} onClick={() => choose(option)}>{option || `Any ${name}`}</button>)}{!matches.length && query ? <p className="gallery-filter-empty" role="status">No Matches</p> : null}</div>
    </div>, document.body) : null}
  </>;
}

/** Structured filters apply to the whole gallery and stay local in Hidden. */

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
  hiddenSpace?: boolean;
  onToggleHidden?: () => void;
  filterTriggerRef?: React.RefObject<HTMLElement | null>;
  filtersOpen?: boolean;
  setFiltersOpen?: (open: boolean) => void;
};

export function GallerySearchBar({ search, setSearch, open, setOpen, hiddenSpace = false, onToggleHidden, filterTriggerRef, filtersOpen: controlledFiltersOpen, setFiltersOpen: controlledSetFiltersOpen, items = [], phone = false }: SearchProps & { islandsHeight?: number; items?: GalleryItem[]; phone?: boolean }) {
  const present = useIsPresent();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const toolsRef = React.useRef<HTMLDivElement>(null);
  const floatingRef = React.useRef<HTMLDivElement>(null);
  const filterControlsRef = React.useRef<HTMLDivElement>(null);
  const [filterHeight, setFilterHeight] = React.useState(0);
  const [localFiltersOpen, setLocalFiltersOpen] = React.useState(false);
  const filterCount = [search.lora, search.model, search.workflow].filter((value) => value?.trim()).length + Number(search.favorites);
  const filterActive = filterCount > 0 || hiddenSpace;
  const queryActive = Boolean(search.q.trim());
  const active = queryActive || filterActive;
  const searchExpanded = open || queryActive;
  const filtersRequested = controlledFiltersOpen ?? localFiltersOpen;
  const filtersOpen = filtersRequested || filterActive;
  const setFiltersOpen = controlledSetFiltersOpen ?? setLocalFiltersOpen;
  const closeFilters = React.useCallback(() => setFiltersOpen(false), [setFiltersOpen]);
  const closeSearch = React.useCallback(() => setOpen(false), [setOpen]);
  const reducedMotion = useReducedMotion();
  useDismiss([toolsRef, floatingRef, filterTriggerRef || toolsRef], filtersOpen && !filterActive, closeFilters);
  useDismiss([toolsRef, floatingRef, filterTriggerRef || toolsRef], open && !queryActive, closeSearch);
  React.useEffect(() => {
    if (filterActive && !filtersRequested) setFiltersOpen(true);
  }, [filterActive, filtersRequested, setFiltersOpen]);
  React.useLayoutEffect(() => {
    const controls = filterControlsRef.current;
    if (!controls) { setFilterHeight(0); return; }
    const measure = () => {
      const height = controls.getBoundingClientRect().height + 8;
      setFilterHeight(height);
      toolsRef.current?.closest<HTMLElement>('.gallery-toolbar, .phone-shell')?.style.setProperty('--gallery-filter-row-h', `${height}px`);
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
  const suggestions = (values: unknown[]) => [...new Set(values.flatMap((value) => typeof value === 'string' && value ? [value] : []))].sort();
  const options = {
    lora: items.flatMap((item) => (Array.isArray(item.settings?.loras) ? item.settings.loras : []).map((lora) => lora.name)),
    model: items.flatMap((item) => [item.model, item.settings?.modelName]),
  };
  return <motion.div ref={toolsRef} className={cn(phone ? 'phone-searchbar' : 'gallery-search-tools', active && 'is-active')} style={{ '--gallery-filter-row-h': `${filterHeight}px` } as React.CSSProperties} role="search" data-open-surface aria-hidden={!present || undefined} inert={!present} initial={phone ? { opacity: 0, y: -6 } : false} animate={{ opacity: 1, y: 0 }} exit={phone ? { opacity: 0, y: -6 } : undefined} transition={reducedMotion ? { duration: 0 } : springs.moderate}>
    <motion.div className={cn('gallery-search', searchExpanded && 'is-expanded')} initial={false} animate={{ width: searchExpanded ? 220 : 48 }} transition={reducedMotion ? { duration: 0 } : springs.moderate}>
      <button type="button" className="gallery-search-trigger" aria-label={phone ? 'Expand Search' : hiddenSpace ? 'Search Hidden' : 'Search Gallery'} aria-expanded={searchExpanded} title="Search" aria-controls={`${id}-query`} onClick={() => { setOpen(!open); if (queryActive) inputRef.current?.focus({ preventScroll: true }); }}><Search size={16} /></button>
      <motion.div className="gallery-search-field" aria-hidden={!searchExpanded || !present} initial={false} animate={{ opacity: searchExpanded && present ? 1 : 0 }} transition={reducedMotion ? { duration: 0 } : springs.moderate}>
        <input id={`${id}-query`} ref={inputRef} value={search.q} disabled={!searchExpanded || !present} tabIndex={searchExpanded && present ? 0 : -1} onChange={(event) => setSearch({ ...search, q: event.target.value.slice(0, 200) })}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!queryActive) setOpen(false); event.currentTarget.blur(); }
            if (event.key === 'Enter') event.currentTarget.blur();
          }} placeholder="Search" aria-label={hiddenSpace ? 'Search Hidden' : 'Search the gallery'} spellCheck={false} autoComplete="off" enterKeyHint="search" />
      </motion.div>
      {searchExpanded ? <button type="button" className="gallery-query-close" aria-label="Clear search" title="Clear Search & Close" onClick={() => { setSearch({ ...search, q: '' }); setOpen(false); }}><X size={14} /></button> : null}
    </motion.div>
    <motion.div className={cn('gallery-filter-anchor', filtersOpen && 'is-expanded')} transition={reducedMotion ? { duration: 0 } : springs.moderate}>
      <button type="button" className={cn('gallery-filter-trigger', (filterCount > 0 || hiddenSpace) && 'is-on')} aria-label="Gallery Filters" title="Filters" aria-expanded={filtersOpen} aria-controls={`${id}-filters`} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={16} /><span className="gallery-filter-label">Filters</span></button>
      <AnimatePresence initial={false}>
        {filtersOpen ? <motion.div id={`${id}-filters`} className="gallery-filter-panel" role="group" aria-label="Gallery Filters" initial={{ width: 0, opacity: 0 }} animate={{ width: 'auto', opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={reducedMotion ? { duration: 0 } : springs.moderate}>
          <div className="gallery-filter-controls" ref={filterControlsRef}>
          {onToggleHidden ? <button type="button" className={cn('gallery-filter-icon', hiddenSpace && 'is-on')} aria-label={hiddenSpace ? 'Show Gallery' : 'Show Hidden'} title={hiddenSpace ? 'Show Gallery' : 'Show Hidden'} aria-pressed={hiddenSpace} onClick={onToggleHidden}>{hiddenSpace ? <Eye size={16} /> : <EyeOff size={16} />}</button> : null}
          <button type="button" className={cn('gallery-filter-icon', search.favorites && 'is-on')} aria-pressed={search.favorites} aria-label="Only favourites" title="Only Favourites" onClick={() => setSearch({ ...search, favorites: !search.favorites })}><Star size={16} fill={search.favorites ? 'currentColor' : 'none'} /></button>
          {(['model', 'lora'] as const).map((key) => {
            const name = key === 'lora' ? 'LoRA' : 'Model';
            const Icon = key === 'model' ? Boxes : Layers;
            return <GalleryFilterPicker key={key} name={name} value={search[key] || ''} values={suggestions([search[key], ...options[key]])} icon={Icon} onChange={value => setSearch({ ...search, [key]: value })} floatingRef={floatingRef} />;
          })}
          {filterCount || hiddenSpace ? <button type="button" className="gallery-filter-icon" aria-label="Clear Filters" title="Clear Filters" onClick={() => { setSearch({ ...search, favorites: false, lora: '', model: '', workflow: '' }); if (hiddenSpace) onToggleHidden?.(); }}><X size={16} /></button> : null}
          </div>
        </motion.div> : null}
      </AnimatePresence>
    </motion.div>

  </motion.div>;
}

/** What an empty result says, and the one way back. */
export function SearchEmpty({ search, onClear, hiddenSpace = false }: { search: GallerySearch; onClear: () => void; hiddenSpace?: boolean }) {
  const words = search.q.trim() || [search.model, search.workflow, search.lora].filter(Boolean).join(" · ");
  const onlyStars = search.favorites && !words;
  return (
    <section className="gallery">
      <div className="empty stage-empty search-empty" aria-live="polite">
        <div className="stage-mark"><SearchMark className="stage-layer" star={onlyStars} /></div>
        <div className="stage-copy">
          <h2>{onlyStars ? 'No Favourites Yet' : <>Nothing Matches “{words}”{search.favorites ? ' in Favourites' : ''}</>}</h2>
          <p>{onlyStars
            ? `Star an image${hiddenSpace ? ' in Hidden' : ''} and it shows up here.`
            : 'Search covers prompts, models and LoRAs. Try fewer words.'}</p>
          <div className="empty-actions">
            <button type="button" className="reconnect-btn primary" onClick={onClear}><X size={13} /> {onlyStars ? 'Show Everything' : 'Clear Search'}</button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ Phone */

export function PhoneSearchBar(props: Omit<SearchProps, 'count'> & { items?: GalleryItem[] }) {
  const visible = props.open || searchActive(props.search) || Boolean(props.hiddenSpace) || Boolean(props.filtersOpen);
  return <AnimatePresence initial={false}>{visible ? <GallerySearchBar key="phone-search" {...props} phone /> : null}</AnimatePresence>;
}
