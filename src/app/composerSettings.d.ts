export function composerSettings(value?: Record<string, any>): Record<string, any>;
export function modeSettings(draft?: Record<string, any>): Partial<Record<'image' | 'video', Record<string, any>>>;
export function modePrompts(draft?: Record<string, any>): Record<'image' | 'video', { prompt: string; negative: string }>;
export function reusedNegative(value: unknown, current: string): string;
export function canRestoreLoras(requestRevision: number, currentRevision: number, found: boolean): boolean;
export type ModeReference = { assets: import('./types').SelectedReferenceAsset[]; image: string; id: string; name: string };
export function modeReferences(draft?: Record<string, any>): Record<'image' | 'video', ModeReference>;
export function savedModeReferences(references: Record<'image' | 'video', ModeReference>): Record<'image' | 'video', ModeReference>;
