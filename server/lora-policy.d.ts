import type { Profile } from '../src/app/types';
export type LoraCompatibility = { baseModels?: string[]; conditionings?: string[]; profileIds?: string[]; unlisted?: 'unknown' | 'other' };
export type LoraStrengthRange = { min: number; max: number; step: number; default?: number };
export type LoraPolicyInfo = { families?: string[]; compatibility?: LoraCompatibility; strengthRange?: LoraStrengthRange };
export function loraCompatibility(info: LoraPolicyInfo | undefined, profile: Partial<Profile> | null): 'fits' | 'unknown' | 'other';
export function strengthRange(info?: LoraPolicyInfo): LoraStrengthRange | null;
export function compatibilityNote(info: LoraPolicyInfo | undefined, profile: Partial<Profile> | null): string;
