import type { GalleryItem, Profile } from './types';

export function outputProfile(profiles: Profile[], item: GalleryItem): Profile | undefined;
export function reuseNumber(value: unknown, fallback: unknown, range?: { min?: number; max?: number; offset?: number; step?: number }, defaultStep?: number): number | undefined;
export function normaliseReusedSettings(profile: Profile, item: GalleryItem, options?: { available?: Record<string, any>; fallback?: boolean; current?: Record<string, unknown> }): Record<string, any>;
