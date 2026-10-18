import type { Profile } from './types';
import type { LoraInfo } from './useLoraInfo';
export function recipeKey(profile?: Profile): string;
export function modelRecipeOptions(profiles: Profile[], selectedId: string): Profile[];
export function recipesFor(profiles: Profile[], selectedId: string): Profile[];
export function optionalLoras(options: string[], infos: Record<string, LoraInfo>, profile?: Profile | null): string[];
export function loraRoleLabel(info?: LoraInfo): string;
export function recipeModelMenu<T extends { favorites: string[]; recents: string[]; toggleFavorite: (id: string) => void }>(menu: T | undefined, profiles: Profile[], selectedId: string): T | undefined;
