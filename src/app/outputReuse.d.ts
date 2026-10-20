import type { GalleryItem, Profile } from './types';

export function outputProfile(profiles: Profile[], item: GalleryItem): Profile | undefined;
export function reuseNumber(value: unknown, fallback: unknown, range?: { min?: number; max?: number; offset?: number; step?: number }, defaultStep?: number): number | undefined;
export function normaliseReusedSettings(profile: Profile, item: GalleryItem, options?: { available?: Record<string, any>; fallback?: boolean; current?: Record<string, unknown>; loraInfos?: Record<string, any> }): Record<string, any>;
export function compatibleLoras<T extends { name: string }>(loras: T[], profile: Partial<Profile>, loraInfos?: Record<string, any>): { loras: T[]; removed: number };
export function removedLorasNote(count: number): string;
