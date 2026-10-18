import { modelName } from './catalogueNames.js';

/** Only explicit recipe metadata groups workflows; a family match alone proves no shared recipe. */
export function recipeKey(profile) {
  if (!profile?.recipe?.modelLabel || !profile.recipe.label || !profile.recipe.conditioning || !profile.baseModel) return `profile:${profile?.id}`;
  return JSON.stringify([profile.kind, profile.family, profile.baseModel, profile.recipe.conditioning]);
}

export function modelRecipeOptions(profiles, selectedId) {
  const groups = new Map();
  for (const profile of profiles) {
    const key = recipeKey(profile);
    const group = groups.get(key) || [];
    group.push(profile);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const selected = group.find((profile) => profile.id === selectedId) || group[0];
    const detail = modelName(selected).detail;
    const label = selected.recipe ? [selected.recipe.modelLabel, detail !== (selected.familyName || selected.family) ? detail : ''].filter(Boolean).join(' · ') : selected.label;
    return selected.recipe ? { ...selected, displayName: label, label, recipeProfiles: group } : selected;
  });
}

export function recipesFor(profiles, selectedId) {
  const selected = profiles.find((profile) => profile.id === selectedId);
  if (!selected?.recipe) return [];
  return profiles.filter((profile) => recipeKey(profile) === recipeKey(selected))
    .sort((a, b) => a.recipe.label.localeCompare(b.recipe.label, undefined, { numeric: true }));
}

/** Known infrastructure stays in library management; unclassified files remain available. */
export function optionalLoras(options, infos, profile) {
  const owned = new Set(profile?.recipe?.adapters || []);
  return options.filter((name) => !owned.has(name) && !['acceleration', 'supporting'].includes(infos[name]?.role));
}

export function loraRoleLabel(info) {
  return info?.role === 'acceleration' ? 'Acceleration Adapter' : info?.role === 'supporting' ? 'Supporting File' : 'Effect LoRA';
}


/** Favourites and recents remain saved against their original workflow IDs. */
export function recipeModelMenu(menu, profiles, selectedId) {
  if (!menu) return menu;
  const models = modelRecipeOptions(profiles, selectedId);
  const groupFor = (id) => models.find((model) => (model.recipeProfiles || [model]).some((profile) => profile.id === id));
  const ids = (values) => [...new Set(values.map((id) => groupFor(id)?.id).filter(Boolean))];
  return {
    ...menu,
    favorites: ids(menu.favorites),
    recents: ids(menu.recents),
    toggleFavorite: (id) => {
      const model = groupFor(id);
      const starred = (model?.recipeProfiles || [model]).filter((profile) => profile && menu.favorites.includes(profile.id));
      if (starred.length) starred.forEach((profile) => menu.toggleFavorite(profile.id));
      else menu.toggleFavorite(id);
    },
  };
}
