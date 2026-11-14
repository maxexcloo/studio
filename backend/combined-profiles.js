import { ownerDocuments, writeRuntimeDocument } from "./persistence/runtime.ts";
import { isObject } from "./values.js";

/**
 * Per-profile preferences that follow a merged or combined profile id to the id it became
 * (profile/store.js `canonical`): workflow preferences (favourites and last use) and every
 * account's LoRA stacks (the active stack and strengths). Combine
 * Backends and Merge Duplicate Profiles move them when they run.
 */

/** Preferences on the kept ids: the latest use wins. */
export function repointedPreferences(preferences, canonical) {
  return {
    favorites: [...new Set(preferences.favorites.map(canonical))],
    lastUsed: Object.entries(preferences.lastUsed).reduce((next, [id, when]) => {
      const kept = canonical(id);
      if (!next[kept] || String(when) > String(next[kept])) next[kept] = when;
      return next;
    }, {}),
  };
}

/**
 * Moves each key `canonical` changes onto its kept id, merged with `join(kept's own, moved)`.
 * Returns the moved count.
 */
function moveKeys(entries, canonical, join) {
  let moved = 0;
  for (const [id, value] of Object.entries(entries)) {
    const kept = canonical(id);
    if (kept === id) continue;
    entries[kept] = Object.hasOwn(entries, kept) ? join(entries[kept], value) : value;
    delete entries[id];
    moved += 1;
  }
  return moved;
}

/**
 * A LoRA stacks state with merged ids' entries on the kept id; the kept id's own active stack and
 * strengths win. Mutates and returns the moved count. Older states are the stacks alone.
 */
function repointLoraState(state, canonical) {
  const stacks = isObject(state.stacks) ? state.stacks : isObject(state.library) ? {} : state;
  let moved = moveKeys(stacks, canonical, (own) => own);
  const library = isObject(state.library) ? state.library : {};
  if (isObject(library.strengths))
    moved += moveKeys(library.strengths, canonical, (own, old) => ({
      ...(isObject(old) ? old : {}),
      ...(isObject(own) ? own : {}),
    }));
  return moved;
}

/**
 * Moves merged ids' LoRA stacks and strengths onto the kept ids in every account's stacks.
 * Returns `{<document>: moved}`.
 */
export function repointLoraStacks(dataDir, canonical) {
  const moved = {};
  for (const { name, value: state } of ownerDocuments(dataDir, "lora-stacks")) {
    if (!isObject(state)) continue;
    const count = repointLoraState(state, canonical);
    if (!count) continue;
    moved[name] = count;
    writeRuntimeDocument(dataDir, name, state);
  }
  return moved;
}
