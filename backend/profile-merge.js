// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings › Profiles › Merge Duplicate Profiles: an administrator's explicit, repeatable action,
 * never run at startup.
 *
 * Two profile files are duplicates when they share a name and kind and run the same definition:
 * the same graph (node titles aside), the same profile block apart from id, name and description,
 * the same guide binding and negatives, and the same AI-Drafted state. The kept profile is the one
 * whose id follows `<kind>-…-<backend>` (`video-h3-first-frame-fast-comfyui`); a group where no
 * single id does is listed, not merged. Same-named profiles that differ are listed with what
 * differs.
 *
 * Applying copies the removed files and the records it changes to
 * `<data>/backups/profile-merges/<time>/`, records each removed id as an alias of the kept one
 * (profile-store.js), then removes the removed files. Version history stays, so a seed never brings
 * a merged id back. Gallery records, presets, jobs, Chats and taste signals keep the ids they hold;
 * readers resolve them through the aliases.
 */
import fs from "node:fs";
import path from "node:path";
import { graphFromJson, userWorkflowsDir } from "./custom-workflows.js";
import { dataDir } from "./gallery-store.js";
import { writeJsonFile } from "./json-store.js";
import { listEditableProfiles, readEditableProfile } from "./profile-editor.js";
import { guideStore, hashOf, profileStore } from "./profile-store.js";
import { loadWorkflowPreferences, repointWorkflowPreferences } from "./workflow-catalog.js";

const newerId = /^(image|video)-[a-z0-9._-]+-(comfyui|radiance|cloud)$/;
const ignoredFields = new Set(["id", "name", "description"]);
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** JSON with sorted keys, so key order never makes two definitions differ. */
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sorted(value[key])]),
  );
}

/** The parts of a profile that decide what it runs, each as comparable JSON. */
function parts(raw, guides, meta) {
  const block = raw?.studio || {};
  const graph = Object.fromEntries(
    Object.entries(graphFromJson(raw) || {}).map(([id, node]) => {
      const { _meta: _title, ...rest } = node || {};
      return [id, rest];
    }),
  );
  const id = `custom:${block.id}`;
  return {
    graph: JSON.stringify(sorted(graph)),
    ...Object.fromEntries(
      Object.keys(block)
        .filter((key) => !ignoredFields.has(key))
        .map((key) => [key, JSON.stringify(sorted(block[key]))]),
    ),
    guide: JSON.stringify(sorted(guides?.profiles?.[id] ?? null)),
    negatives: JSON.stringify(sorted(guides?.negatives?.[id] ?? null)),
    aiDrafted: String(meta?.aiDrafted === true),
  };
}

const differing = (left, right) =>
  [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter((key) => left[key] !== right[key])
    .sort();

/**
 * What a merge would do now: `merges` ({from, to, name, kind}), `differing` (same name, different
 * definitions, with the parts that differ) and `unresolved` (duplicates with no single id to keep).
 * `hash` identifies the plan and every file in it, so applying refuses a stale preview.
 */
export function duplicateProfiles() {
  const guides = guideStore().read();
  const metas = profileStore({ workflowsDir: userWorkflowsDir }).metas();
  const groups = new Map();
  for (const item of listEditableProfiles()) {
    if (!item.readable) continue;
    const { text, hash } = readEditableProfile(item.id);
    const raw = JSON.parse(text);
    if ((raw?.studio?.id || item.id) !== item.id) continue;
    const key = `${item.kind}\u0000${item.name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...item, hash, parts: parts(raw, guides, metas[item.id]) });
  }
  const merges = [];
  const different = [];
  const unresolved = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const clusters = new Map();
    for (const member of members) {
      const signature = hashOf(member.parts);
      if (!clusters.has(signature)) clusters.set(signature, []);
      clusters.get(signature).push(member);
    }
    const sets = [...clusters.values()].map((set) => set.sort((a, b) => a.id.localeCompare(b.id)));
    for (const set of sets) {
      if (set.length < 2) continue;
      const kept = set.filter((member) => newerId.test(member.id));
      if (kept.length !== 1) {
        unresolved.push({
          ids: set.map((member) => member.id),
          name: set[0].name,
          kind: set[0].kind,
          reason: kept.length
            ? "More than one id follows the <kind>-…-<backend> naming."
            : "No id follows the <kind>-…-<backend> naming.",
        });
        continue;
      }
      for (const member of set)
        if (member !== kept[0])
          merges.push({
            from: member.id,
            to: kept[0].id,
            name: member.name,
            kind: member.kind,
            fromHash: member.hash,
            toHash: kept[0].hash,
          });
    }
    if (sets.length > 1) {
      const [first, ...rest] = sets.map((set) => set[0]);
      different.push({
        name: first.name,
        kind: first.kind,
        ids: sets.flatMap((set) => set.map((member) => member.id)),
        differences: [...new Set(rest.flatMap((other) => differing(first.parts, other.parts)))],
      });
    }
  }
  merges.sort((a, b) => a.from.localeCompare(b.from));
  return {
    hash: hashOf(merges.map(({ from, to, fromHash, toHash }) => [from, to, fromHash, toHash])),
    merges,
    differing: different,
    unresolved,
  };
}

/**
 * Merges what `duplicateProfiles` previews. Nothing to merge is a no-op, so a repeat is safe;
 * otherwise `hash` must be the preview's, and a changed plan is refused (409). Returns the merges and the backup folder.
 */
export function mergeDuplicateProfiles({ hash, by = "" } = {}) {
  const plan = duplicateProfiles();
  if (!plan.merges.length) return { merged: [], backup: "" };
  if (hash !== plan.hash)
    throw Object.assign(
      new Error("The duplicate profiles changed since the preview. Preview them again."),
      { status: 409 },
    );
  const store = profileStore({ workflowsDir: userWorkflowsDir });
  const at = new Date().toISOString();
  const backup = path.join(dataDir, "backups", "profile-merges", at.replace(/[:.]/g, "-"));
  fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
  const preferences = loadWorkflowPreferences();
  writeJsonFile(
    path.join(backup, "merge.json"),
    {
      at,
      by: String(by || ""),
      merges: plan.merges.map(({ from, to }) => ({ from, to })),
      aliasesBefore: store.aliases(),
      preferencesBefore: preferences,
    },
    { mode: 0o600 },
  );
  for (const { from } of plan.merges) {
    const { text } = readEditableProfile(from);
    fs.writeFileSync(path.join(backup, `${from}.json`), text, { mode: 0o600 });
    // History keeps the removed definition, and marks the id as one Studio held.
    store.record(from, text, { by, origin: "studio", note: "Before merging as a duplicate" });
  }
  // Aliases first: an interrupted merge leaves both files, and previewing again finishes it.
  store.addAliases(
    plan.merges.map(({ from, to }) => ({ from, to, reason: "duplicate" })),
    { by, at },
  );
  for (const { from } of plan.merges) fs.rmSync(path.join(userWorkflowsDir, `${from}.json`));
  repointWorkflowPreferences((id) => store.canonical(id));
  return {
    merged: plan.merges.map(({ from, to, name, kind }) => ({ from, to, name, kind })),
    backup: path.relative(dataDir, backup),
  };
}
