import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loraStackFiles } from "./combined-profiles.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { verifiedBackup } from "./persistence/migration.ts";

/**
 * The migrate-runtime step that turns each account's LoRA favourites into thumbs up: every
 * `lora-stacks.json` library's `favorites` list becomes `ratings` of "up" (a rating already set
 * wins) and the list goes. Plans by default; `apply` copies the files it changes to a
 * `.backups/lora-ratings-*` folder (its `mapping.json` names each copy's source) and then writes
 * them, with Studio stopped. A second run finds nothing.
 */
export function loraRatings(dataDir, { apply = false } = {}) {
  const changes = [];
  for (const file of loraStackFiles(dataDir)) {
    const state = readJsonFile(file);
    const favourites = state?.library?.favorites;
    if (!Array.isArray(favourites)) continue;
    const source = path.relative(dataDir, file);
    changes.push({ file, source, state, favourites: favourites.length });
  }
  const plan = {
    files: changes.map(({ source, favourites }) => ({
      source,
      copy: source.replaceAll(path.sep, "__"),
      favourites,
    })),
  };
  if (!apply || !changes.length) return { ...plan, applied: false, backup: "" };

  const backup = verifiedBackup(
    dataDir,
    "lora-ratings",
    changes.map(({ file }, index) => {
      const bytes = fs.readFileSync(file);
      return {
        source: plan.files[index].copy,
        hash: crypto.createHash("sha256").update(bytes).digest("hex"),
        bytes,
      };
    }),
    plan,
  );
  for (const { file, state } of changes) {
    const { favorites, ...library } = state.library;
    const ratings = { ...library.ratings };
    for (const name of favorites) {
      const key = String(name || "").trim();
      if (key) ratings[key] ??= "up";
    }
    writeJsonFile(file, { ...state, library: { ...library, ratings } });
  }
  return { ...plan, applied: true, backup };
}
