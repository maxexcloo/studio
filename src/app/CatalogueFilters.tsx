import { cn } from './format';
import type { PickerViews } from './PickerTools';
import { scrollSideways, useWheelRef } from './wheel';

export type CatalogueFilter = { favourites: boolean; speed: '' | 'standard' | 'flash' };
export const emptyCatalogueFilter: CatalogueFilter = { favourites: false, speed: '' };

export function CatalogueFilters({ value, onChange }: { value: CatalogueFilter; onChange: (value: CatalogueFilter) => void }) {
  const wheelRef = useWheelRef<HTMLDivElement>(scrollSideways);
  const button = (label: string, active: boolean, next: CatalogueFilter, title?: string) => <button type="button" aria-pressed={active} className={cn(active && 'active')} title={title} onClick={() => onChange(next)}>{label}</button>;
  return <div ref={wheelRef} className="model-filters" role="group" aria-label="Filter Models">
    <span className="model-filter-group model-filter-library">
      {button('All', !value.favourites && !value.speed, emptyCatalogueFilter)}
      {button('Favourites', value.favourites, { ...value, favourites: !value.favourites })}
    </span>
    <span className="model-filter-group" role="group" aria-label="Speed">
      <span className="model-filter-label">Speed</span>
      {button('Fast', value.speed === 'flash', { ...value, speed: value.speed === 'flash' ? '' : 'flash' }, 'Accelerated generation recipes')}
      {button('Quality', value.speed === 'standard', { ...value, speed: value.speed === 'standard' ? '' : 'standard' }, 'Full sampling recipes')}
    </span>
  </div>;
}

/**
 * The same filters for a phone picker's heading dropdown: All, then
 * Favourites, Fast and Quality as ticks that combine (Fast and Quality take
 * turns), so the menu stays open while choosing.
 */
export function catalogueViews(value: CatalogueFilter, onChange: (value: CatalogueFilter) => void): PickerViews {
  const parts = [value.favourites && 'Favourites', value.speed === 'flash' && 'Fast', value.speed === 'standard' && 'Quality'].filter(Boolean) as string[];
  return {
    label: 'Filter Models',
    current: parts.length ? parts.join(', ') : 'All',
    multi: true,
    options: [
      { id: 'all', label: 'All', checked: !value.favourites && !value.speed, onSelect: () => onChange(emptyCatalogueFilter) },
      { id: 'favourites', label: 'Favourites', checked: value.favourites, onSelect: () => onChange({ ...value, favourites: !value.favourites }) },
      { id: 'fast', label: 'Fast', checked: value.speed === 'flash', onSelect: () => onChange({ ...value, speed: value.speed === 'flash' ? '' : 'flash' }) },
      { id: 'quality', label: 'Quality', checked: value.speed === 'standard', onSelect: () => onChange({ ...value, speed: value.speed === 'standard' ? '' : 'standard' }) },
    ],
  };
}
