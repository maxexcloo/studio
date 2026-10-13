import type { Profile } from './types';
export function modelName(profile?: Partial<Profile> | null): { name: string; detail: string };
export function modelFamily(profile?: Partial<Profile> | null): string;
export function modelGroups(profiles: Profile[]): { id: string; label: string; rows: Profile[] }[];
export function loraName(name: string, info?: { title?: string }): string;
export function modelLoras(options: string[], fitOf: (name: string) => 'fits' | 'unknown' | 'other', all?: boolean): string[];
export function loraCompatibility(info: { families: string[] } | undefined, profile: Partial<Profile> | null): 'fits' | 'unknown' | 'other';
