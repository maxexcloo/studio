// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio's seed. Studio is the only writer of live profiles and
 * guides; the profiles repository (`ai/`) is their seed and backup, and `profiles:deploy`
 * is retired. `STUDIO_CONFIG_DIR` is the read-only ai seed with `profiles/` and the configuration
 * JSON files at its root. `STUDIO_SEED_DIR` can instead name an unpacked
 * Settings › Profiles › Export, which has the same layout:
 *
 *   profiles/*.json       profiles
 *   prompting.json        prompting guides
 *   lora-catalogue.json   the LoRA catalogue
 *   catalogue.json        editable model catalogue metadata
 *   models.json           the restore manifest
 *
 * An export made before the flat layout keeps them under `config/` (profiles in
 * `config/studio/workflows/`), and is still read.
 *
 * At each start the seed fills only what is missing: a profile file Studio has never held (no
 * file and no version history, so one removed in Studio never comes back) and a `config/` file
 * the data folder doesn't have. Nothing Studio holds is ever overwritten, and the seed directory
 * is only read. Without either source setting nothing is copied.
 */
import fs from "node:fs";
import path from "node:path";
import { configurationDirectory } from "./config-directory.js";

const validId = (id) => /^[a-z0-9][a-z0-9._-]{0,79}$/.test(id) && !id.includes("..");
export const seedConfigFiles = Object.freeze([
  "catalogue.json",
  "prompting.json",
  "lora-catalogue.json",
  "models.json",
]);

/** The seed directory from the environment, or ''. */
export const seedDirectory = (environment = process.env) =>
  String(environment.STUDIO_SEED_DIR || configurationDirectory(environment)).trim();

function copyNew(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const temporary = `${to}.${process.pid}.seed.tmp`;
  fs.copyFileSync(from, temporary);
  try {
    fs.linkSync(temporary, to);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

/**
 * Copies what the data folder is missing from the seed. `store` is the profile store (its
 * `known(id)` and `record`). Returns what it did; a missing seed directory is a warning only.
 */
export function seedMissing({
  seedDir,
  dataDir,
  workflowsDir = path.join(dataDir, "workflows"),
  store,
  log = console,
}) {
  const result = { profiles: [], config: [], kept: 0, skipped: [] };
  if (!seedDir) return result;
  if (!fs.existsSync(seedDir)) {
    log.warn?.(`[seed] The seed directory (${seedDir}) doesn’t exist; nothing was seeded.`);
    return result;
  }
  const mountedLayout =
    fs.existsSync(path.join(seedDir, "profiles")) ||
    seedConfigFiles.some((name) => fs.existsSync(path.join(seedDir, name)));
  const workflows = mountedLayout
    ? path.join(seedDir, "profiles")
    : path.join(seedDir, "config", "studio", "workflows");
  let names = [];
  try {
    names = fs
      .readdirSync(workflows)
      .filter((name) => name.endsWith(".json") && !name.startsWith("."))
      .sort();
  } catch {
    /* A seed without profiles. */
  }
  for (const name of names) {
    const id = name.slice(0, -5);
    if (!validId(id)) continue;
    const target = path.join(workflowsDir, name);
    if (fs.existsSync(target)) {
      result.kept += 1;
      continue;
    }
    // Studio held it once and it is gone: removed in Studio, so the seed doesn't bring it back.
    if (store.known(id)) {
      result.skipped.push(id);
      continue;
    }
    let text;
    try {
      text = fs.readFileSync(path.join(workflows, name), "utf8");
      JSON.parse(text);
    } catch {
      log.warn?.(`[seed] Skipped ${name}: it isn’t readable JSON.`);
      continue;
    }
    try {
      copyNew(path.join(workflows, name), target);
    } catch (error) {
      if (error.code === "EEXIST") {
        result.kept += 1;
        continue;
      }
      throw error;
    }
    store.record(id, text, { origin: "seed", by: "seed", note: "From the seed" });
    result.profiles.push(id);
  }
  for (const name of seedConfigFiles) {
    const source = path.join(seedDir, ...(mountedLayout ? [] : ["config"]), name);
    const target = path.join(dataDir, "config", name);
    if (!fs.existsSync(source) || fs.existsSync(target)) continue;
    try {
      copyNew(source, target);
      result.config.push(name);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  if (result.profiles.length || result.config.length)
    log.info?.(
      `[seed] Added ${result.profiles.length} missing profile${result.profiles.length === 1 ? "" : "s"}${result.config.length ? ` and ${result.config.join(", ")}` : ""} from ${seedDir}; nothing Studio holds was changed.`,
    );
  return result;
}
