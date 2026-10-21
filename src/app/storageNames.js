/**
 * Browser storage keys Studio renamed when it became a hard fork of HEISS UI.
 * Each old key (and its per-account `:account:<id>` copy) moves to its new
 * name the first time the page starts, unless the new one is there already,
 * so nobody loses preferences, drafts or LoRA favourites. Only the new names
 * are written afterwards.
 */
export const renamedStorageKeys = Object.freeze([
  ["studio-draft", "heiss-ui-draft"],
  ["studio-grid-autoplay", "heiss-grid-autoplay"],
  ["studio-inpaint-introduced", "heiss-ui-inpaint-introduced"],
  ["studio-lora-library", "heiss-ui-lora-library"],
  ["studio-lora-merged-v2", "heiss-ui-lora-merged-v2"],
  ["studio-lora-pending", "heiss-ui-lora-pending"],
  ["studio-prefs", "heiss-ui-prefs"],
  ["studio-unstacked-runs", "heiss-ui-unstacked-runs"],
  ["studio.generationMosaic.crashed", "heiss.generationMosaic.crashed"],
  ["studio.generationMosaic.running", "heiss.generationMosaic.running"],
  ["studio:model-folders-dismissed", "heiss-ui:model-folders-dismissed"],
  ["studio:starter-pick", "heiss-ui:starter-pick"]
]);

/** Session storage, which lasts one tab. */
export const renamedSessionKeys = Object.freeze([["studio-force-phone", "heiss-force-phone"]]);

/** The new name for an old key, keeping a per-account suffix; "" for any other key. */
export function currentStorageKey(key, renamed = renamedStorageKeys) {
  for (const [current, legacy] of renamed) {
    if (key === legacy) return current;
    if (key.startsWith(`${legacy}:account:`)) return current + key.slice(legacy.length);
  }
  return "";
}

/**
 * Moves every old key in `storage` to its new name, in place. A key whose new
 * name already holds a value is dropped: that one was written later. Returns
 * the number moved. Storage that refuses (private mode, full) is left alone.
 */
export function migrateStorageKeys(storage, renamed = renamedStorageKeys) {
  if (!storage) return 0;
  let moved = 0;
  try {
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) keys.push(storage.key(index));
    for (const key of keys) {
      const next = key ? currentStorageKey(key, renamed) : "";
      if (!next) continue;
      const value = storage.getItem(key);
      if (storage.getItem(next) === null && value !== null) {
        storage.setItem(next, value);
        moved += 1;
      }
      storage.removeItem(key);
    }
  } catch {
    // Kept as it is; the old values just aren't carried over in this browser.
  }
  return moved;
}
