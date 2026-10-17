export function imageDimension(value: number, metadata?: { min?: number; max?: number; step?: number }): number;
import type { GalleryItem, Profile } from './types';

export function outputProfile(profiles: Profile[], item: GalleryItem): Profile | undefined;
export function profileCountRange(profile?: Partial<Profile> | null, kind?: string): { min: number; max: number; step: number; offset?: number };
export function clampProfileCount(profile: Partial<Profile> | null | undefined, count: unknown, kind?: string): number;
export function profileImageCount(profile: Profile, fallback?: number): number;
export function profileImageSize(profile?: Profile | null, kind?: string): { width: number; height: number };
export function referenceImageSize(profile: Profile | null | undefined, reference: { width?: number; height?: number } | null | undefined, options?: { pixels?: number; resize?: boolean }): { width: number; height: number } | null;
export function generationPlan(options: { count: number; kind: string; profile?: Partial<Profile> | null; references?: unknown[]; queueMode?: string }): { effectiveCount: number; separate: boolean; imageRuns: number; requestCount: number };
