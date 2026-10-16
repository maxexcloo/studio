import React from 'react';
import { Search, SlidersHorizontal, Star, X } from 'lucide-react';
import { cn } from './format';
import { useDismiss } from './useDismiss';
import type { GalleryItem } from './types';
import { emptySearch, searchActive, type GallerySearch } from './favorites';
import { SearchMark } from './SearchMark';

/** Search stays visible; structured filters apply to the whole gallery and stay local in Hidden. */

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
};

export function GallerySearchBar({ search, setSearch, count, open, hiddenSpace = false, items = [], phone = false }: SearchProps & { islandsHeight?: number; items?: GalleryItem[]; phone?: boolean }) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const filterRef = React.useRef<HTMLDivElement>(null);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const closeFilters = React.useCallback(() => setFiltersOpen(false), []);
  useDismiss(filterRef, filtersOpen, closeFilters);
  const active = searchActive(search);
  const filterCount = [search.lora, search.model, search.workflow].filter((value) => value?.trim()).length;
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
  return <div className={cn(phone ? 'phone-searchbar' : 'gallery-search', active && 'is-active')} role="search" data-open-surface>
    <Search size={16} aria-hidden="true" />
    <input ref={inputRef} value={search.q} onChange={(event) => setSearch({ ...search, q: event.target.value.slice(0, 200) })}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setSearch(emptySearch); event.currentTarget.blur(); }
        if (event.key === 'Enter') event.currentTarget.blur();
      }} placeholder={hiddenSpace ? 'Search Hidden' : 'Search Gallery'} aria-label={hiddenSpace ? 'Search Hidden' : 'Search the gallery'} spellCheck={false} autoComplete="off" enterKeyHint="search" />
    {active && typeof count === 'number' ? <span className="gallery-search-count" aria-live="polite" aria-label={`${count} matches`}>{count}</span> : null}
    <button type="button" className={cn('gallery-search-fav', search.favorites && 'is-on')} aria-pressed={search.favorites} aria-label="Only favourites" title="Only Favourites" onClick={() => setSearch({ ...search, favorites: !search.favorites })}><Star size={16} fill={search.favorites ? 'currentColor' : 'none'} /></button>
    <div ref={filterRef} className="gallery-filter-anchor">
      <button type="button" className="gallery-filter-trigger" aria-label="Gallery Filters" aria-expanded={filtersOpen} aria-controls={`${id}-filters`} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={16} />{filterCount ? <span>{filterCount}</span> : null}</button>
      {filtersOpen ? <div id={`${id}-filters`} className="gallery-filter-panel" role="group" aria-label="Gallery Filters">
        {(['model', 'workflow', 'lora'] as const).map((key) => <label key={key}>{key === 'lora' ? 'LoRA' : key === 'model' ? 'Model' : 'Workflow'}
          <input value={search[key] || ''} aria-label={`Filter By ${key === 'lora' ? 'LoRA' : key === 'model' ? 'Model' : 'Workflow'}`} list={`${id}-${key}`} placeholder="Any" onChange={(event) => setSearch({ ...search, [key]: event.target.value.slice(0, 200) })} />
          <datalist id={`${id}-${key}`}>{suggestions(options[key]).map((value) => <option key={value} value={value} />)}</datalist>
        </label>)}
        <p>Matches names across the gallery. Suggestions come from loaded items.</p>
        <button type="button" onClick={() => setSearch({ ...search, lora: '', model: '', workflow: '' })}>Clear Filters</button>
      </div> : null}
    </div>
    {active ? <button type="button" className="gallery-search-close" aria-label="Clear search" onClick={() => setSearch(emptySearch)}><X size={16} /></button> : null}
  </div>;
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
          <h2>{onlyStars ? 'No Favourites Yet' : <>Nothing matches “{words}”{search.favorites ? ' in favourites' : ''}</>}</h2>
          <p>{onlyStars
            ? `Star an image${hiddenSpace ? ' in Hidden' : ''} and it shows up here.`
            : 'Search covers prompts, models and LoRAs. Try fewer words.'}</p>
          <div className="empty-actions">
            <button type="button" className="reconnect-btn primary" onClick={onClear}><X size={13} /> {onlyStars ? 'Show everything' : 'Clear search'}</button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ Phone */

export function PhoneSearchBar(props: Omit<SearchProps, 'count'> & { items?: GalleryItem[] }) {
  return <GallerySearchBar {...props} phone />;
}
