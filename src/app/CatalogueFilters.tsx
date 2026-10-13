import React from 'react';
import { cn } from './format';
import { scrollSideways, useWheelRef } from './wheel';

export type CatalogueFilter = { favourites: boolean; speed: '' | 'standard' | 'flash'; purpose: '' | 'generate' | 'edit' };
export const emptyCatalogueFilter: CatalogueFilter = { favourites: false, speed: '', purpose: '' };

export function CatalogueFilters({ value, onChange }: { value: CatalogueFilter; onChange: (value: CatalogueFilter) => void }) {
  const wheelRef = useWheelRef<HTMLDivElement>(scrollSideways);
  const button = (label: string, active: boolean, next: CatalogueFilter, title?: string) => <button type="button" aria-pressed={active} className={cn(active && 'active')} title={title} onClick={() => onChange(next)}>{label}</button>;
  return <div ref={wheelRef} className="model-filters" role="group" aria-label="Filter Models">
    <span className="model-filter-group">
      {button('All', !value.favourites && !value.speed && !value.purpose, emptyCatalogueFilter)}
      {button('Favourites', value.favourites, { ...value, favourites: !value.favourites })}
    </span>
    <span className="model-filter-group">
      {button('Standard', value.speed === 'standard', { ...value, speed: value.speed === 'standard' ? '' : 'standard' })}
      {button('Flash', value.speed === 'flash', { ...value, speed: value.speed === 'flash' ? '' : 'flash' })}
    </span>
    <span className="model-filter-group">
      {button('Generate', value.purpose === 'generate', { ...value, purpose: value.purpose === 'generate' ? '' : 'generate' }, 'Generate without a reference image')}
      {button('Edit', value.purpose === 'edit', { ...value, purpose: value.purpose === 'edit' ? '' : 'edit' }, 'Use a reference image')}
    </span>
  </div>;
}
