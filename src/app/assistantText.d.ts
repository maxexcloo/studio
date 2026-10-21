export function missingTriggers(prompt: string, triggers: string[]): string[];
export function insertTriggers(prompt: string, triggers: string[]): { prompt: string; inserted: string[] };
export function removeTriggers(prompt: string, triggers: string[]): string;
export function saysAny(prompt: string, triggers: string[]): boolean;
export function stillWritten(prompt: string, written: string): boolean;
