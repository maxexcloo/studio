import React from 'react';
import type { Mode } from './types';
import { cn } from './format';
import { scrollSideways, useWheelRef } from './wheel';

export type CatalogueFilter = { favourites: boolean; speed: '' | 'standard' | 'flash'; purpose: '' | 'generate' | 'edit' };
export const emptyCatalogueFilter: CatalogueFilter = { favourites: false, speed: '', purpose: '' };

export function CatalogueFilters({ kind = 'image', value, onChange }: { kind?: Mode; value: CatalogueFilter; onChange: (value: CatalogueFilter) => void }) {
  const wheelRef = useWheelRef<HTMLDivElement>(scrollSideways);
  const button = (label: string, active: boolean, next: CatalogueFilter, title?: string) => <button type="button" aria-pressed={active} className={cn(active && 'active')} title={title} onClick={() => onChange(next)}>{label}</button>;
  return <div ref={wheelRef} className="model-filters" role="group" aria-label="Filter Models">
    <span className="model-filter-group model-filter-library">
      {button('All', !value.favourites && !value.speed && !value.purpose, emptyCatalogueFilter)}
      {button('Favourites', value.favourites, { ...value, favourites: !value.favourites })}
    </span>
    <span className="model-filter-group" role="group" aria-label="Speed">
      <span className="model-filter-label">Speed</span>
      {button('Standard', value.speed === 'standard', { ...value, speed: value.speed === 'standard' ? '' : 'standard' }, 'Standard generation recipes')}
      {button('Fast', value.speed === 'flash', { ...value, speed: value.speed === 'flash' ? '' : 'flash' }, 'Accelerated generation recipes')}
    </span>
    <span className="model-filter-group" role="group" aria-label="Use">
      <span className="model-filter-label">Use</span>
      {button(kind === 'video' ? 'Non-Reference' : 'Generate', value.purpose === 'generate', { ...value, purpose: value.purpose === 'generate' ? '' : 'generate' }, 'Generate without a reference image')}
      {button(kind === 'video' ? 'Reference' : 'Edit', value.purpose === 'edit', { ...value, purpose: value.purpose === 'edit' ? '' : 'edit' }, 'Use a reference image')}
    </span>
  </div>;
}
