// SPDX-License-Identifier: AGPL-3.0-only
import fs from "node:fs";
import path from "node:path";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { createProfileStore } from "./profile-store.js";
import {
  usesRuntimeDatabase,
  withOfflineDatabase,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";

/**
 * The migrate-runtime step that renames the old `nsfw` marker to `uncensored`: each profile's
 * `"nsfw"` key (as a new version), every `nsfw` key in the model catalogue, its source files and
 * the import records, and each access profile's `nsfwModels` feature. Plans by default; `apply`
 * writes, with Studio stopped. A second run finds nothing. Earlier profile versions keep their text.
 */
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const profileKey = /"nsfw"(\s*):/g;

/** `value` with every `nsfw` key renamed; `count.n` counts them. A kept `uncensored` key wins. */
function renamed(value, count) {
  if (Array.isArray(value)) return value.map((item) => renamed(item, count));
  if (!isObject(value)) return value;
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (key !== "nsfw") next[key] = renamed(item, count);
  }
  if (Object.hasOwn(value, "nsfw")) {
    count.n += 1;
    if (!Object.hasOwn(value, "uncensored")) next.uncensored = renamed(value.nsfw, count);
  }
  return next;
}

/** Catalogue and import JSON whose `nsfw` keys Studio wrote. */
function catalogueFiles(dataDir) {
  const imports = path.join(dataDir, "library", "imports");
  return [
    "library/catalogue.json",
    "lora-catalogue.json",
    "config/lora-catalogue.json",
    "config/catalogue.json",
    "model-download-sources.json",
    ...(fs.existsSync(imports)
      ? fs
          .readdirSync(imports)
          .filter((name) => name.endsWith(".json"))
          .map((name) => `library/imports/${name}`)
      : []),
  ].filter((file) => fs.existsSync(path.join(dataDir, file)));
}

export function uncensoredMarker(dataDir, { apply = false } = {}) {
  const result = { applied: apply, profiles: [], files: {}, accessProfiles: [] };

  const workflowsDir = path.join(dataDir, "workflows");
  const store = createProfileStore({ dataDir, log: { info() {}, warn() {} } });
  for (const name of fs.existsSync(workflowsDir) ? fs.readdirSync(workflowsDir).sort() : []) {
    if (name.startsWith(".") || !name.endsWith(".json")) continue;
    const file = path.join(workflowsDir, name);
    const text = fs.readFileSync(file, "utf8");
    const next = text.replace(profileKey, '"uncensored"$1:');
    if (next === text) continue;
    const id = name.slice(0, -5);
    result.profiles.push(id);
    if (!apply) continue;
    fs.writeFileSync(`${file}.migrate`, next);
    fs.renameSync(`${file}.migrate`, file);
    store.record(id, next, { by: "migrate-runtime", note: "Renamed nsfw to uncensored" });
  }

  for (const file of catalogueFiles(dataDir)) {
    const full = path.join(dataDir, file);
    const count = { n: 0 };
    const next = renamed(readJsonFile(full), count);
    if (!count.n) continue;
    result.files[file] = count.n;
    if (apply) writeJsonFile(full, next);
  }

  result.accessProfiles = updateAccessProfiles(dataDir, { apply }, (features) => {
    if (!Object.hasOwn(features, "nsfwModels")) return false;
    features.uncensoredModels ??= features.nsfwModels;
    delete features.nsfwModels;
    return true;
  });
  return result;
}

/** The migrate-runtime step that gives every existing access profile the Upscale feature, on. */
export function upscaleFeature(dataDir, { apply = false } = {}) {
  const accessProfiles = updateAccessProfiles(dataDir, { apply }, (features) => {
    if (Object.hasOwn(features, "upscale")) return false;
    features.upscale = true;
    return true;
  });
  return { applied: apply, accessProfiles };
}

/**
 * Runs `change(features)` on each access profile's features and saves them when `apply` is set;
 * returns the ids of the profiles it changed (those `change` returns true for).
 */
function updateAccessProfiles(dataDir, { apply }, change) {
  const changed = [];
  const database = usesRuntimeDatabase(dataDir);
  const accountsFile = path.join(dataDir, "accounts.json");
  if (!database && !fs.existsSync(accountsFile)) return changed;
  const accounts = database
    ? withOfflineDatabase(dataDir, (db) => {
        const row = db.prepare("SELECT value FROM studio_documents WHERE name = ?").get("accounts");
        return row ? JSON.parse(row.value) : null;
      })
    : readJsonFile(accountsFile);
  for (const [id, profile] of Object.entries(accounts?.profiles || {}))
    if (isObject(profile?.features) && change(profile.features)) changed.push(id);
  if (apply && changed.length) {
    if (database) writeRuntimeDocument(dataDir, "accounts", accounts);
    else writeJsonFile(accountsFile, accounts);
  }
  return changed;
}
