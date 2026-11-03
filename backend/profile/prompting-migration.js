// SPDX-License-Identifier: AGPL-3.0-only
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadMcpPrompting, mergedPrompting, ownPrompting } from "../mcp/prompting.js";
import { verifiedBackup } from "../persistence/migration.ts";
import { createGuideStore, createProfileStore } from "./store.js";

/**
 * The migrate-runtime step that makes prompting.json the single source of prompting guides: each
 * profile's `studio.prompting` (and each backend's and image mode's) keeps only the fields that
 * differ from what its guide gives it (mcp/prompting.js ownPrompting); an empty one is removed.
 * Plans by default, listing per profile what is removed, kept and newly read from the guide (a
 * field the profile's copy lacked). `apply` copies the changed files to a `.backups/profile-
 * prompting-*` folder with their mapping (restorable with `--restore`), then writes each as a new
 * profile version, with Studio stopped. A second run finds nothing.
 */
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

/**
 * Slims one `holder.prompting` against `base` (what it would read without it) in place and returns
 * what changed (or null), with the prompting it now resolves to.
 */
function slim(holder, base, at) {
  const full = holder.prompting;
  if (!isObject(full)) return { change: null, resolved: base };
  const own = ownPrompting(base, full);
  const resolved = mergedPrompting(base, own);
  const removed = Object.keys(full).filter((key) => !Object.hasOwn(own, key));
  const added = Object.keys(resolved || {}).filter((key) => !Object.hasOwn(full, key));
  if (!removed.length) return { change: null, resolved };
  if (Object.keys(own).length) holder.prompting = own;
  else delete holder.prompting;
  return { change: { at, removed, kept: Object.keys(own), added }, resolved };
}

/** Each image mode's prompting slimmed against `base`, the prompting of the level it sits on. */
function slimModes(level, base, at) {
  return Object.entries(isObject(level.imageModes) ? level.imageModes : {})
    .filter(([, mode]) => isObject(mode))
    .map(([name, mode]) => slim(mode, base, `${at}imageModes.${name}.prompting`).change);
}

export function profilePrompting(dataDir, { apply = false } = {}) {
  const quiet = { info() {}, warn() {} };
  const workflowsDir = path.join(dataDir, "workflows");
  const result = { applied: false, backup: "", profiles: {} };
  const configFile = createGuideStore({ dataDir }).configFile();
  if (!configFile) return result;
  const guideOf = loadMcpPrompting(configFile);
  const changed = [];
  for (const name of fs.existsSync(workflowsDir) ? fs.readdirSync(workflowsDir).sort() : []) {
    if (name.startsWith(".") || !name.endsWith(".json")) continue;
    const file = path.join(workflowsDir, name);
    const bytes = fs.readFileSync(file);
    let raw;
    try {
      raw = JSON.parse(bytes.toString("utf8"));
    } catch {
      continue;
    }
    const studio = raw?.studio;
    if (!isObject(studio)) continue;
    const id = name.slice(0, -5);
    const guide = guideOf({
      id: `custom:${studio.id || id}`,
      family: String(studio.family || "custom"),
      kind: studio.kind === "video" ? "video" : "image",
    });
    const shared = slim(studio, guide, "prompting");
    const changes = [shared.change, ...slimModes(studio, shared.resolved, "")];
    for (const [backend, block] of Object.entries(
      isObject(studio.backends) ? studio.backends : {},
    )) {
      if (!isObject(block)) continue;
      const own = slim(block, shared.resolved, `backends.${backend}.prompting`);
      changes.push(own.change, ...slimModes(block, own.resolved, `backends.${backend}.`));
    }
    const listed = changes.filter(Boolean);
    if (!listed.length) continue;
    result.profiles[id] = listed;
    changed.push({ id, name, bytes, text: `${JSON.stringify(raw, null, 2)}\n` });
  }
  if (!apply || !changed.length) return result;

  const mappings = changed.map(({ name, bytes }) => ({
    source: `workflows/${name}`,
    target: `workflows/${name}`,
    hash: digest(bytes),
  }));
  result.backup = verifiedBackup(
    dataDir,
    "profile-prompting",
    changed.map(({ bytes }, index) => ({
      source: mappings[index].source,
      hash: mappings[index].hash,
      bytes,
    })),
    { mappings, profiles: result.profiles },
  );
  const store = createProfileStore({ dataDir, log: quiet });
  for (const { id, name, text } of changed) {
    const file = path.join(workflowsDir, name);
    fs.writeFileSync(`${file}.migrate`, text);
    fs.renameSync(`${file}.migrate`, file);
    store.record(id, text, {
      by: "migrate-runtime",
      note: "Kept only the prompting fields that differ from the guide",
    });
  }
  result.applied = true;
  return result;
}
