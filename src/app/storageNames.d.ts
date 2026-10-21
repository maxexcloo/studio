export const renamedStorageKeys: ReadonlyArray<readonly [current: string, legacy: string]>;
export const renamedSessionKeys: ReadonlyArray<readonly [current: string, legacy: string]>;
export function currentStorageKey(key: string, renamed?: ReadonlyArray<readonly [string, string]>): string;
export function migrateStorageKeys(storage: Storage | null | undefined, renamed?: ReadonlyArray<readonly [string, string]>): number;
