import { migrateStorageKeys, renamedSessionKeys, renamedStorageKeys } from './storageNames.js';

// Imported first by main.tsx, before any module reads storage: old HEISS UI keys move to Studio's names.
if (typeof window !== 'undefined') {
  try { migrateStorageKeys(window.localStorage, renamedStorageKeys); } catch { /* storage off */ }
  try { migrateStorageKeys(window.sessionStorage, renamedSessionKeys); } catch { /* storage off */ }
}
