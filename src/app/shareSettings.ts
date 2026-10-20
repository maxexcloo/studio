import type { GalleryItem, Preferences } from './types';

/**
 * "Share without settings": downloads and shares leave out the prompt, seed
 * and workflow ComfyUI saved inside the file (the server strips them, see
 * server/metadata-strip.js). Off unless chosen, set from the preferences in
 * main.tsx.
 */
let current = false;

export function setShareSettings(prefs: Pick<Preferences, 'shareWithoutSettings'>) {
  current = prefs.shareWithoutSettings;
}

/** Whether this item's downloads and shares go out without its settings. */
export function sharesWithoutSettings(_item?: Pick<GalleryItem, 'id'>) {
  return current;
}
