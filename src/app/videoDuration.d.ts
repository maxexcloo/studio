import type { Profile } from './types';
export function durationSeconds(frames: number, fps: number): string;
export function validVideoFrames(profile: Profile | null | undefined, frames: number): number;
export function durationOptions(profile: Profile | null | undefined, frames: number, fps: number): { value: string; label: string }[];
