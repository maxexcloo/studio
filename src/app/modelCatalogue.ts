import React from 'react';
import { emptyCatalogueFilter, type CatalogueFilter } from './CatalogueFilters';
import { compareModelNames, modelFamily, modelGroups, modelName, profileMatchesFilters } from './catalogueNames';
import { modelRecipeOptions, recipeModelMenu } from './modelRecipes';
import type { Profile } from './types';

/** Favourites and recents for the model menu, and how to change them. */
export type ModelMenuState = {
  favorites: string[];
  /** Profile ids, most recently used first. */
  recents: string[];
  toggleFavorite: (id: string) => void;
};

export type ModelSection = { id: string; label: string; rows: Profile[] };

/** What an unready model still lacks, in the words the gallery badges use; "" when it can run. */
export function setupNote(profile: Profile | null) {
  const missing = profile?.missing || [];
  if (!missing.length) return '';
  if (missing.some((item) => item.part === 'comfy' && !item.nodePack)) return 'Needs a newer ComfyUI';
  if (missing.some((item) => item.nodePack)) return 'Needs ComfyUI nodes';
  return `Needs ${missing.length} file${missing.length === 1 ? '' : 's'}`;
}

/** Metadata supplied by the model profile, shared by desktop and phone model menus. */
export function modelDetails(profile: Profile) {
  const name = modelName(profile);
  const images = profile.mediaInputs?.filter((input) => input.kind === 'image') || [];
  const capacity = images.length && images.every((input) => Number.isFinite(input.max) && Number(input.max) > 0)
    ? images.reduce((sum, input) => sum + Number(input.max), 0) : 0;
  const references = capacity ? `${capacity} Reference Image${capacity === 1 ? '' : 's'}` : images.length ? 'Reference Images' : '';
  return [...new Set([name.detail, profile.label !== name.name ? profile.label : '', modelFamily(profile), profile.kind === 'video' ? 'Video' : 'Image', references].filter(Boolean))].join(' · ');
}

function profileText(profile: Profile) {
  return `${profile.displayName || ''} ${profile.label || ''} ${profile.description || ''} ${modelFamily(profile)} ${profile.model || ''}`.toLowerCase();
}

/**
 * The model catalogue behind both the desktop model menu and the phone model
 * sheet: one row per recipe, favourites saved against workflow ids, search by
 * every word, the catalogue filters, and sections (a search lists its hits;
 * otherwise Favourites, then each family).
 */
export function useModelCatalogue(modelProfiles: Profile[], selectedId: string, modelMenu?: ModelMenuState) {
  const [query, setQuery] = React.useState('');
  const [filters, setFilters] = React.useState<CatalogueFilter>(emptyCatalogueFilter);
  const profiles = React.useMemo(() => modelRecipeOptions(modelProfiles || [], selectedId).sort(compareModelNames), [modelProfiles, selectedId]);
  const menu = React.useMemo(() => recipeModelMenu(modelMenu, modelProfiles || [], selectedId), [modelMenu, modelProfiles, selectedId]);
  const favourites = React.useMemo(() => new Set(menu?.favorites || []), [menu]);
  const needle = query.trim().toLowerCase();

  const sections = React.useMemo<ModelSection[]>(() => {
    const matching = profiles.filter((profile) => profileMatchesFilters(profile, filters, menu?.favorites));
    if (needle) {
      const words = needle.split(/\s+/);
      return [{ id: 'results', label: '', rows: matching.filter((profile) => words.every((word) => profileText(profile).includes(word))) }].filter((section) => section.rows.length);
    }
    return [
      { id: 'favorites', label: 'Favourites', rows: matching.filter((profile) => favourites.has(profile.id)) },
      // The rest by family, so seven Sana variants sit together instead of scattering.
      ...modelGroups(matching)
    ].filter((section) => section.rows.length);
  }, [favourites, filters, menu, needle, profiles]);
  const flat = React.useMemo(() => sections.flatMap((section) => section.rows), [sections]);

  return {
    profiles,
    selected: profiles.find((profile) => profile.id === selectedId) || profiles[0] || null,
    menu,
    isFavourite: (id: string) => favourites.has(id),
    query,
    setQuery,
    filters,
    setFilters,
    sections,
    flat,
    noMatchText: needle ? `Nothing matches “${query.trim()}”.` : 'No Models Match These Filters.'
  };
}
