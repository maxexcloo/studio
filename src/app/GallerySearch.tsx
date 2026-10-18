import React from 'react';
import { createPortal } from 'react-dom';
import { Boxes, ChevronDown, Eye, EyeOff, Layers, Search, SlidersHorizontal, Star, Workflow, X } from 'lucide-react';
import { cn } from './format';
import { useDismiss } from './useDismiss';
import type { GalleryItem } from './types';
import { emptySearch, searchActive, type GallerySearch } from './favorites';
import { SearchMark } from './SearchMark';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'framer-motion';
import { springs } from '@/lib/springs';

function GalleryFilterPicker({ name, value, values, icon: Icon, onChange, floatingRef }: { name: string; value: string; values: string[]; icon: typeof Boxes; onChange: (value: string) => void; floatingRef: React.RefObject<HTMLDivElement | null> }) {
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState({ left: 0, top: 0, maxHeight: 240 });
  const anchor = React.useRef<HTMLButtonElement>(null);
  const menu = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  const close = React.useCallback(() => setOpen(false), []);
  useDismiss([anchor, menu], open, close);
  React.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = anchor.current!.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 16;
      const height = Math.min(240, Math.max(below, rect.top - 16));
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 248)), top: below >= Math.min(180, rect.top - 16) ? rect.bottom + 8 : Math.max(8, rect.top - height - 8), maxHeight: height });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  React.useEffect(() => {
    if (open) (menu.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]') || menu.current?.querySelector('button'))?.focus({ preventScroll: true });
  }, [open]);
  const choose = (next: string) => { onChange(next); setOpen(false); anchor.current?.focus({ preventScroll: true }); };
  return <>
    <button ref={anchor} type="button" className={cn('gallery-filter-select', value && 'is-on')} aria-label={`Filter By ${name}`} title={`${name}: ${value || 'Any'}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}><Icon size={16} /><span>{value || name}</span><ChevronDown size={12} /></button>
    {open ? createPortal(<div id={id} ref={node => { menu.current = node; floatingRef.current = node; }} className="aspect-menu gallery-filter-menu" role="listbox" aria-label={`${name} Filter`} style={position} onKeyDown={event => {
      const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')];
      const index = options.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') { event.preventDefault(); options[event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); anchor.current?.focus({ preventScroll: true }); }
    }}>{['', ...values].map(option => <button type="button" key={option} className={cn('aspect-option', option === value && 'active')} role="option" tabIndex={option === value ? 0 : -1} aria-selected={option === value} onClick={() => choose(option)}>{option || `Any ${name}`}</button>)}</div>, document.body) : null}
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
    workflow: items.flatMap((item) => [item.settings?.workflow, item.settings?.profileId]),
  };
  return <motion.div ref={toolsRef} className={cn(phone ? 'phone-searchbar' : 'gallery-search-tools', active && 'is-active')} style={{ '--gallery-filter-row-h': `${filterHeight}px` } as React.CSSProperties} role="search" data-open-surface aria-hidden={!present || undefined} inert={!present} initial={phone ? { opacity: 0, y: -6 } : false} animate={{ opacity: 1, y: 0 }} exit={phone ? { opacity: 0, y: -6 } : undefined} transition={reducedMotion ? { duration: 0 } : springs.moderate}>
    <motion.div className={cn('gallery-search', searchExpanded && 'is-expanded')} initial={false} animate={{ width: searchExpanded ? 220 : 48 }} transition={reducedMotion ? { duration: 0 } : springs.moderate}>
      <button type="button" className={cn('gallery-search-trigger', queryActive && 'is-on')} aria-label={phone ? 'Expand Search' : hiddenSpace ? 'Search Hidden' : 'Search Gallery'} aria-expanded={searchExpanded} title={hiddenSpace ? 'Search Hidden' : 'Search Gallery'} aria-controls={`${id}-query`} onClick={() => { setOpen(!open); if (queryActive) inputRef.current?.focus({ preventScroll: true }); }}><Search size={16} /></button>
      <motion.div className="gallery-search-field" aria-hidden={!searchExpanded || !present} initial={false} animate={{ opacity: searchExpanded && present ? 1 : 0 }} transition={reducedMotion ? { duration: 0 } : springs.moderate}>
        <input id={`${id}-query`} ref={inputRef} value={search.q} disabled={!searchExpanded || !present} tabIndex={searchExpanded && present ? 0 : -1} onChange={(event) => setSearch({ ...search, q: event.target.value.slice(0, 200) })}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!queryActive) setOpen(false); event.currentTarget.blur(); }
            if (event.key === 'Enter') event.currentTarget.blur();
          }} placeholder={hiddenSpace ? 'Search Hidden' : 'Search Gallery'} aria-label={hiddenSpace ? 'Search Hidden' : 'Search the gallery'} spellCheck={false} autoComplete="off" enterKeyHint="search" />
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
          {(['model', 'workflow', 'lora'] as const).map((key) => {
            const name = key === 'lora' ? 'LoRA' : key === 'model' ? 'Model' : 'Workflow';
            const Icon = key === 'model' ? Boxes : key === 'workflow' ? Workflow : Layers;
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
