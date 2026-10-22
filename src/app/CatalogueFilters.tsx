import React from 'react';
import { Star } from 'lucide-react';
import { cn } from './format';
import type { PickerViews } from './PickerTools';
import { scrollSideways, useWheelRef } from './wheel';

export type CatalogueFilter = { favourites: boolean; speed: '' | 'standard' | 'flash' };
export const emptyCatalogueFilter: CatalogueFilter = { favourites: false, speed: '' };

/** The one view a filter shows: All, Favourites, Fast or Quality (an older pair of picks reads as Favourites). */
type CatalogueView = 'all' | 'favourites' | 'fast' | 'quality';
const catalogueView = (value: CatalogueFilter): CatalogueView => value.favourites ? 'favourites' : value.speed === 'flash' ? 'fast' : value.speed === 'standard' ? 'quality' : 'all';
const viewFilter: Record<CatalogueView, CatalogueFilter> = {
  all: emptyCatalogueFilter,
  favourites: { favourites: true, speed: '' },
  fast: { favourites: false, speed: 'flash' },
  quality: { favourites: false, speed: 'standard' },
};
const viewNames: Record<CatalogueView, string> = { all: 'All', favourites: 'Favourites', fast: 'Fast', quality: 'Quality' };

/**
 * The model chooser's views, one choice at a time like References' and LoRAs'
 * (UI-PATTERNS › Pickers): All · ★ · Fast · Quality on the same selector track.
 * Choosing one leaves the others; choosing the one showing again goes back to All.
 */
export function CatalogueFilters({ value, onChange }: { value: CatalogueFilter; onChange: (value: CatalogueFilter) => void }) {
  const wheelRef = useWheelRef<HTMLDivElement>(scrollSideways);
  const current = catalogueView(value);
  const button = (view: CatalogueView, label: React.ReactNode, title?: string, ariaLabel?: string) => <button type="button" aria-pressed={current === view} aria-label={ariaLabel} className={cn(current === view && 'active')} title={title} onClick={() => onChange(viewFilter[view === current && view !== 'all' ? 'all' : view])}>{label}</button>;
  return <div ref={wheelRef} className="model-filters reference-tabs" role="group" aria-label="Filter Models">
    {button('all', 'All')}
    {button('favourites', <Star size={14} fill="currentColor" aria-hidden="true" />, 'Favourites', 'Favourites')}
    {button('fast', 'Fast', 'Accelerated generation recipes')}
    {button('quality', 'Quality', 'Full sampling recipes')}
  </div>;
}

/** The same views for a phone picker's heading dropdown: one choice, which closes the menu. */
export function catalogueViews(value: CatalogueFilter, onChange: (value: CatalogueFilter) => void): PickerViews {
  const current = catalogueView(value);
  return {
    label: 'Filter Models',
    current: viewNames[current],
    options: (Object.keys(viewNames) as CatalogueView[]).map((view) => ({ id: view, label: viewNames[view], checked: current === view, onSelect: () => onChange(viewFilter[view]) })),
  };
}
