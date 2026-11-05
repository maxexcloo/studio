/**
 * The migrate-runtime step that gives the live profiles and guides their clean ids.
 *
 * Profile ids follow `<kind>-<model>[-<variant>]-<speed>`: no backend ending (a profile names its
 * backends in `studio.backends`), plain versions (`fineporn-6`, not `fineporn-v6`) and the speed
 * tier last; Grok's cloud profiles have no speed tier and end in their model version. Each renamed
 * profile's file, version history, meta and edit record move to the new id, its alias
 * (profile/store.js, reason "renamed") keeps every record that names the old id resolving, and
 * the references that are cheap to rewrite move with it: guide bindings and negatives, group
 * grants, workflow preferences, LoRA stacks and run timings. Gallery records, jobs, presets,
 * prompt history, Dream, comparisons and MCP records keep the old id and resolve through the alias.
 * Guide packs are renamed with their meta and versions, and the families and profiles bound to
 * them follow.
 *
 * Plans by default, listing the mapping, conflicts (a new id already held by another profile or
 * guide, left as it is) and the references it rewrites; `apply` copies every file and the accounts
 * document it changes to `.backups/profile-ids-*` with a `mapping.json` (restorable with
 * `--restore`), then renames. It may run while Studio runs: profile files, aliases and guides are
 * read afresh, and runtime-migrations.js reloads the accounts, workflow preferences and timings it
 * holds. An interrupted apply finishes on the next run; a second run finds nothing.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { repointedPreferences, repointLoraState, loraStackFiles } from "../combined-profiles.js";
import { readJsonFile, writeJsonFile } from "../json-store.js";
import { verifiedBackup } from "../persistence/migration.ts";
import { withOfflineDatabase, writeRuntimeDocument } from "../persistence/runtime.ts";
import { createGuideStore, createProfileStore } from "./store.js";

export const profileRenames = Object.freeze({
  "image-fineporn-v6-fast-comfyui": "image-fineporn-6-fast",
  "image-fineporn-v6-quality-comfyui": "image-fineporn-6-quality",
  "image-flux2-klein-9b-base-comfyui": "image-flux2-klein-9b-base-quality",
  "image-flux2-klein-9b-kv-comfyui": "image-flux2-klein-9b-kv-fast",
  "image-flux3-klein-base": "image-flux3-klein-base-quality",
  "image-flux3-klein-distilled": "image-flux3-klein-distilled-fast",
  "image-grok-imagine-2.0-cloud": "image-grok-imagine-2",
  "image-grok-imagine-cloud": "image-grok-imagine",
  "image-krea2-turbo": "image-krea2-turbo-fast",
  "image-kroma-turbo-fast-comfyui": "image-kroma-turbo-fast",
  "image-kromafine-turbo-fast-comfyui": "image-kromafine-turbo-fast",
  "image-moss-sft-comfyui": "image-moss-sft-quality",
  "image-moss-sft-turbo-comfyui": "image-moss-sft-turbo-fast",
  "image-noctq-v4-lightning-radiance": "image-noctq-4-lightning-fast",
  "image-noctq-v4-radiance": "image-noctq-4-quality",
  "image-qwen-image-2.1": "image-qwen-image-2.1-quality",
  "image-qwen-image-2.1-turbo": "image-qwen-image-2.1-turbo-fast",
  "image-z-image-turbo-comfyui": "image-z-image-turbo-fast",
  "video-grok-imagine-1.5-cloud": "video-grok-imagine-1.5",
  "video-grok-imagine-cloud": "video-grok-imagine",
  "video-h3-first-frame-fast": "video-minimax-h3-first-frame-fast",
  "video-h3-first-frame-quality": "video-minimax-h3-first-frame-quality",
  "video-h3-reference-fast-comfyui": "video-minimax-h3-reference-fast",
  "video-h3-reference-quality-comfyui": "video-minimax-h3-reference-quality",
});

export const guideRenames = Object.freeze({
  "fineporn-v6-turbo-nsfw-v6-int8": "fineporn-6",
  moss_image: "moss-image",
});

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const by = "migrate-runtime";

/** Every file under `dir`, relative to `dataDir`. */
const filesIn = (dataDir, dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.relative(dataDir, path.join(entry.parentPath, entry.name)))
    : [];

export function profileIds(dataDir, { apply = false } = {}) {
  const workflowsDir = path.join(dataDir, "workflows");
  const profileFile = (id) => path.join(workflowsDir, `${id}.json`);
  const store = createProfileStore({ dataDir, log: { info() {}, warn() {} } });
  const guides = createGuideStore({ dataDir });
  const aliases = store.aliases();
  const result = {
    applied: false,
    backup: "",
    profiles: [],
    guides: [],
    conflicts: [],
    bindings: 0,
    grants: {},
    preferences: 0,
    loraStacks: {},
    timings: 0,
  };

  // A rename is still to do while the old file exists; one whose alias is recorded resumes.
  const renames = {};
  for (const [from, to] of Object.entries(profileRenames)) {
    const resumed = aliases[from]?.to === to;
    if (!fs.existsSync(profileFile(from))) {
      if (resumed) renames[from] = to;
      continue;
    }
    if (fs.existsSync(profileFile(to)) && !resumed) {
      result.conflicts.push({ from, to, reason: "Another profile has the new id." });
      continue;
    }
    renames[from] = to;
    result.profiles.push({ from, to });
  }
  const guideStore = guides.read() || {};
  const packs = {};
  for (const [from, to] of Object.entries(guideRenames)) {
    if (!guideStore.packs?.[from]) continue;
    if (guideStore.packs[to]) {
      result.conflicts.push({ from, to, reason: "Another guide has the new id." });
      continue;
    }
    packs[from] = to;
    result.guides.push({ from, to });
  }

  /** A renamed id's new one, as `custom:<id>` or bare; any other value as it is. */
  const follow = (value) => {
    if (typeof value !== "string") return value;
    const prefixed = value.startsWith("custom:");
    const to = renames[prefixed ? value.slice(7) : value];
    return to ? `${prefixed ? "custom:" : ""}${to}` : value;
  };

  const bindings = isObject(guideStore.profiles) ? guideStore.profiles : {};
  const negatives = isObject(guideStore.negatives) ? guideStore.negatives : {};
  const boundKeys = Object.fromEntries(
    Object.keys(renames)
      .map((from) => [`custom:${from}`, `custom:${renames[from]}`])
      .filter(([key]) => Object.hasOwn(bindings, key) || Object.hasOwn(negatives, key)),
  );
  result.bindings =
    Object.keys(boundKeys).filter((key) => Object.hasOwn(bindings, key)).length +
    Object.keys(boundKeys).filter((key) => Object.hasOwn(negatives, key)).length;

  const accountsText = withOfflineDatabase(
    dataDir,
    (db) => db.prepare("SELECT value FROM studio_documents WHERE name = ?").get("accounts")?.value,
  );
  const accounts = accountsText ? JSON.parse(accountsText) : null;
  for (const [group, grant] of Object.entries(
    isObject(accounts?.profiles) ? accounts.profiles : {},
  ))
    if (Array.isArray(grant?.generationProfiles)) {
      const moved = grant.generationProfiles.filter((id) => follow(id) !== id).length;
      if (moved) result.grants[group] = moved;
    }

  const preferencesFile = path.join(dataDir, "workflow-preferences.json");
  const preferences = fs.existsSync(preferencesFile) ? readJsonFile(preferencesFile) : null;
  const before = {
    favorites: Array.isArray(preferences?.favorites) ? preferences.favorites : [],
    lastUsed: isObject(preferences?.lastUsed) ? preferences.lastUsed : {},
  };
  result.preferences = [...before.favorites, ...Object.keys(before.lastUsed)].filter(
    (id) => follow(id) !== id,
  ).length;

  const stacks = [];
  for (const file of loraStackFiles(dataDir)) {
    const state = readJsonFile(file);
    if (!isObject(state)) continue;
    const moved = repointLoraState(state, follow);
    if (!moved) continue;
    result.loraStacks[path.relative(dataDir, file)] = moved;
    stacks.push({ file, state });
  }

  // Run timings are keyed `<kind>:<model>[@<backend>]` (generation-timing.js timingKey).
  const timingsFile = path.join(dataDir, "timings.json");
  const timings = fs.existsSync(timingsFile) ? readJsonFile(timingsFile) : null;
  const timingKey = (key) => {
    const [, kind, model, backend = ""] = /^(image|video):([^@]*)(@.*)?$/.exec(key) || [];
    return kind ? `${kind}:${follow(model)}${backend}` : key;
  };
  result.timings = (Array.isArray(timings?.runs) ? timings.runs : []).filter(
    (run) => typeof run?.key === "string" && timingKey(run.key) !== run.key,
  ).length;

  const changes =
    result.profiles.length +
    result.guides.length +
    result.bindings +
    Object.keys(result.grants).length +
    result.preferences +
    Object.keys(result.loraStacks).length +
    result.timings;
  if (!apply || !changes) return result;

  const copies = [
    ...result.profiles.flatMap(({ from }) => [
      `workflows/${from}.json`,
      ...filesIn(dataDir, path.join(dataDir, "history", "profiles", from)),
    ]),
    ...result.guides.flatMap(({ from }) =>
      filesIn(dataDir, path.join(dataDir, "history", "guides", from)),
    ),
    "workflows/.studio-aliases.json",
    "workflows/.studio-meta.json",
    "workflows/.studio-edits.json",
    "guides/prompting.json",
    "workflow-preferences.json",
    "timings.json",
    ...stacks.map(({ file }) => path.relative(dataDir, file)),
  ]
    .filter((source) => fs.existsSync(path.join(dataDir, source)))
    .map((source) => ({ source, bytes: fs.readFileSync(path.join(dataDir, source)) }));
  if (Object.keys(result.grants).length)
    copies.push({ source: "accounts.json", bytes: Buffer.from(accountsText) });
  for (const copy of copies) copy.hash = digest(copy.bytes);
  const mappings = copies.map(({ source, hash }) => ({
    source,
    target: source === "accounts.json" ? "studio_documents/accounts" : source,
    hash,
  }));
  result.backup = verifiedBackup(dataDir, "profile-ids", copies, {
    mappings,
    profiles: result.profiles,
    guides: result.guides,
  });

  for (const { from, to } of result.profiles) {
    const raw = readJsonFile(profileFile(from));
    raw.studio = { ...raw.studio, id: to };
    const text = `${JSON.stringify(raw, null, 2)}\n`;
    store.rename(from, to, text, { by, note: `Renamed from ${from}` });
    fs.writeFileSync(`${profileFile(to)}.migrate`, text);
    fs.renameSync(`${profileFile(to)}.migrate`, profileFile(to));
    fs.rmSync(profileFile(from));
  }
  guides.rename({ packs, profiles: boundKeys }, { by, note: "Renamed profiles and guides" });
  if (Object.keys(result.grants).length) {
    for (const grant of Object.values(accounts.profiles))
      if (Array.isArray(grant?.generationProfiles))
        grant.generationProfiles = [...new Set(grant.generationProfiles.map(follow))];
    writeRuntimeDocument(dataDir, "accounts", accounts);
  }
  if (result.preferences)
    writeJsonFile(preferencesFile, { ...preferences, ...repointedPreferences(before, follow) });
  for (const { file, state } of stacks) writeJsonFile(file, state);
  if (result.timings)
    writeJsonFile(timingsFile, {
      ...timings,
      runs: timings.runs.map((run) =>
        typeof run?.key === "string" ? { ...run, key: timingKey(run.key) } : run,
      ),
    });
  result.applied = true;
  return result;
}
