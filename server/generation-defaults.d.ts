import type { Profile } from '../src/app/types';

export const defaultGenerationCount: number;
export function profileImageSize(profile?: Profile | null, kind?: string): { width: number; height: number };
export function referenceImageSize(profile: Profile | null | undefined, reference: { width?: number; height?: number } | null | undefined, options?: { pixels?: number; resize?: boolean }): { width: number; height: number } | null;
