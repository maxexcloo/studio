import fs from "node:fs";
import path from "node:path";
import { ownerDocuments, savedDocument, writeRuntimeDocument } from "./persistence/runtime.ts";
import { createGuideStore, createProfileStore } from "./profile/store.js";
import { isObject } from "./values.js";

/**
 * Per-profile preferences that follow a merged or combined profile id to the id it became
 * (profile/store.js `canonical`): workflow preferences (favourites and last use) and every
 * account's LoRA stacks (the active stack, strengths and older per-workflow snapshots). Combine
 * Backends and Merge Duplicate Profiles move them when they run; `combinedProfiles` is the
 * migrate-runtime step that moves what production's earlier combines left behind and prunes
 * guide bindings of profiles that no longer exist.
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
export function repointLoraState(state, canonical) {
  const stacks = isObject(state.stacks) ? state.stacks : isObject(state.library) ? {} : state;
  let moved = moveKeys(stacks, canonical, (own) => own);
  const library = isObject(state.library) ? state.library : {};
  if (isObject(library.strengths))
    moved += moveKeys(library.strengths, canonical, (own, old) => ({
      ...(isObject(old) ? old : {}),
      ...(isObject(own) ? own : {}),
    }));
  if (isObject(library.snapshots))
    moved += moveKeys(library.snapshots, canonical, (own, old) => {
      const list = Array.isArray(own) ? own : [];
      const ids = new Set(list.map((stack) => stack?.id));
      return [...list, ...(Array.isArray(old) ? old : []).filter((stack) => !ids.has(stack?.id))];
    });
  return moved;
}

/**
 * Moves merged ids' LoRA stacks and strengths onto the kept ids in every account's stacks.
 * Returns `{<document>: moved}`.
 */
export function repointLoraStacks(dataDir, canonical, { apply = true } = {}) {
  const moved = {};
  for (const { name, value: state } of ownerDocuments(dataDir, "lora-stacks")) {
    if (!isObject(state)) continue;
    const count = repointLoraState(state, canonical);
    if (!count) continue;
    moved[name] = count;
    if (apply) writeRuntimeDocument(dataDir, name, state);
  }
  return moved;
}

/**
 * The migrate-runtime step: follows `workflows/.studio-aliases.json` for workflow preferences and
 * LoRA stacks, and drops guide bindings, variants and negatives keyed by a `custom:<id>` whose
 * profile file is gone. Plans by default; `apply` writes, with Studio stopped. A second run finds
 * nothing.
 */
export function combinedProfiles(dataDir, { apply = false } = {}) {
  const workflowsDir = path.join(dataDir, "workflows");
  const quiet = { info() {}, warn() {} };
  const { canonical } = createProfileStore({ dataDir, log: quiet });
  const result = { applied: apply, preferences: 0, loraStacks: {}, guideBindings: [] };

  const raw = savedDocument(dataDir, "workflow-preferences");
  if (raw !== undefined) {
    const before = {
      favorites: Array.isArray(raw?.favorites) ? raw.favorites : [],
      lastUsed: isObject(raw?.lastUsed) ? raw.lastUsed : {},
    };
    const next = repointedPreferences(before, canonical);
    result.preferences = [...before.favorites, ...Object.keys(before.lastUsed)].filter(
      (id) => canonical(id) !== id,
    ).length;
    if (apply && result.preferences)
      writeRuntimeDocument(dataDir, "workflow-preferences", { ...raw, ...next });
  }

  result.loraStacks = repointLoraStacks(dataDir, canonical, { apply });

  const guides = createGuideStore({ dataDir });
  const { bindings } = guides.bindings();
  const exists = (key) =>
    !key.startsWith("custom:") || fs.existsSync(path.join(workflowsDir, `${key.slice(7)}.json`));
  result.guideBindings = [
    ...new Set(Object.values(bindings).flatMap((section) => Object.keys(section))),
  ]
    .filter((key) => !exists(key))
    .sort();
  if (apply && result.guideBindings.length)
    guides.moveProfileBindings(
      { remove: result.guideBindings },
      {
        by: "migrate-runtime",
        note: "Removed bindings of profiles that no longer exist",
      },
    );
  return result;
}
