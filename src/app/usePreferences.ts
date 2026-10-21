import { useState } from 'react';
import { loadPrefs, savePrefs } from './api';
import { showToastTone as showToast } from './toast';
import type { Preferences } from './types';

/** This browser's preferences (api.ts keeps them per account): read once, saved on every change. */
export function usePreferences() {
  const [prefs, setPrefsState] = useState<Preferences>(() => loadPrefs());
  function setPrefs(next: Partial<Preferences>) {
    const merged = { ...prefs, ...next };
    setPrefsState(merged);
    try {
      savePrefs(merged);
    } catch {
      showToast("Couldn’t save settings", "error");
    }
  }
  return { prefs, setPrefs, setPrefsState };
}
