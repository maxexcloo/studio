import crypto from "node:crypto";
import { verifiedBackup } from "../persistence/migration.ts";
import { ownerDocumentFile, ownerDocuments, writeRuntimeDocument } from "../persistence/runtime.ts";

/**
 * The migrate-runtime step that turns each account's LoRA favourites into thumbs up: every
 * `lora-stacks:<key>` library's `favorites` list becomes `ratings` of "up" (a rating already set
 * wins) and the list goes. Plans by default; `apply` copies the documents it changes to a
 * `.backups/lora-ratings-*` folder (its `mapping.json` names each copy's source) and then writes
 * them, with Studio stopped. A second run finds nothing.
 */
export function loraRatings(dataDir, { apply = false } = {}) {
  const changes = [];
  for (const { name, value: state } of ownerDocuments(dataDir, "lora-stacks")) {
    const favourites = state?.library?.favorites;
    if (!Array.isArray(favourites)) continue;
    changes.push({ name, state, favourites: favourites.length });
  }
  const plan = {
    files: changes.map(({ name, favourites }) => ({
      source: name,
      copy: ownerDocumentFile(name).replaceAll("/", "__"),
      favourites,
    })),
  };
  if (!apply || !changes.length) return { ...plan, applied: false, backup: "" };

  const backup = verifiedBackup(
    dataDir,
    "lora-ratings",
    changes.map(({ state }, index) => {
      const bytes = Buffer.from(JSON.stringify(state));
      return {
        source: plan.files[index].copy,
        hash: crypto.createHash("sha256").update(bytes).digest("hex"),
        bytes,
      };
    }),
    plan,
  );
  for (const { name, state } of changes) {
    const { favorites, ...library } = state.library;
    const ratings = { ...library.ratings };
    for (const item of favorites) {
      const key = String(item || "").trim();
      if (key) ratings[key] ??= "up";
    }
    writeRuntimeDocument(dataDir, name, { ...state, library: { ...library, ratings } });
  }
  return { ...plan, applied: true, backup };
}
