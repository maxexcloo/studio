import type { GalleryItem, Profile } from './types';

export function outputProfile(profiles: Profile[], item: GalleryItem): Profile | undefined;
export function profileImageCount(profile: Profile, fallback: number): number;
export function profileImageSize(profile?: Profile | null, kind?: string): { width: number; height: number };
export function generationPlan(options: { count: number; kind: string; profile?: Partial<Profile> | null; references?: unknown[]; queueMode?: string }): { effectiveCount: number; separate: boolean; imageRuns: number; requestCount: number };
