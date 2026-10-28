// SPDX-License-Identifier: AGPL-3.0-only
import fs from "node:fs";
import path from "node:path";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { createGuideStore, createProfileStore } from "./profile-store.js";

/**
 * Per-profile preferences that follow a merged or combined profile id to the id it became
 * (profile-store.js `canonical`): workflow preferences (favourites, last use, thumbnails) and every
 * account's LoRA stacks (the active stack, strengths and older per-workflow snapshots). Combine
 * Backends and Merge Duplicate Profiles move them when they run; `combinedProfiles` is the
 * migrate-runtime step that moves what production's earlier combines left behind and prunes
 * guide bindings of profiles that no longer exist.
 */
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Preferences on the kept ids: the latest use wins, and a kept id's own thumbnail. */
export function repointedPreferences(preferences, canonical) {
  return {
    favorites: [...new Set(preferences.favorites.map(canonical))],
    lastUsed: Object.entries(preferences.lastUsed).reduce((next, [id, when]) => {
      const kept = canonical(id);
      if (!next[kept] || String(when) > String(next[kept])) next[kept] = when;
      return next;
    }, {}),
    thumbnails: Object.entries(preferences.thumbnails).reduce((next, [id, url]) => {
      const kept = canonical(id);
      if (!next[kept] || kept === id) next[kept] = url;
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
 * A lora-stacks.json state with merged ids' entries on the kept id; the kept id's own active stack
 * and strengths win. Mutates and returns the moved count. Older files are the stacks alone.
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

/** The shared and every account's lora-stacks.json in a data folder. */
export function loraStackFiles(dataDir) {
  const accounts = path.join(dataDir, "accounts");
  const owners = fs.existsSync(accounts) ? fs.readdirSync(accounts) : [];
  return [
    path.join(dataDir, "lora-stacks.json"),
    ...owners.map((owner) => path.join(accounts, owner, "lora-stacks.json")),
  ].filter((file) => fs.existsSync(file));
}

/** Moves merged ids' LoRA stacks and strengths onto the kept ids. Returns `{<file>: moved}`. */
export function repointLoraStacks(dataDir, canonical, { apply = true } = {}) {
  const moved = {};
  for (const file of loraStackFiles(dataDir)) {
    const state = readJsonFile(file);
    if (!isObject(state)) continue;
    const count = repointLoraState(state, canonical);
    if (!count) continue;
    moved[path.relative(dataDir, file)] = count;
    if (apply) writeJsonFile(file, state);
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

  const preferencesFile = path.join(dataDir, "workflow-preferences.json");
  if (fs.existsSync(preferencesFile)) {
    const raw = readJsonFile(preferencesFile);
    const before = {
      favorites: Array.isArray(raw?.favorites) ? raw.favorites : [],
      lastUsed: isObject(raw?.lastUsed) ? raw.lastUsed : {},
      thumbnails: isObject(raw?.thumbnails) ? raw.thumbnails : {},
    };
    const next = repointedPreferences(before, canonical);
    result.preferences = [
      ...before.favorites,
      ...Object.keys(before.lastUsed),
      ...Object.keys(before.thumbnails),
    ].filter((id) => canonical(id) !== id).length;
    if (apply && result.preferences) writeJsonFile(preferencesFile, { ...raw, ...next });
  }

  result.loraStacks = repointLoraStacks(dataDir, canonical, { apply });

  const guides = createGuideStore({ dataDir, seedFile: "", log: quiet });
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
