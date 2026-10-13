import type { ComfyStatus } from './types';
export function statusForProfile(status: ComfyStatus, profile: { kind?: string; family?: string }): ComfyStatus;
