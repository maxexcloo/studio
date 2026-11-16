import { dataDir } from "../data-dir.js";
import {
  ownerDocumentName,
  ownerDocuments,
  readRuntimeDocument,
  runtimeDatabase,
  writeRuntimeDocument,
} from "../persistence/runtime.ts";

/** Each account's `lora-stacks:<key>` document (runtime.ts ownerDocumentName), holding its LoRA ratings. */
const stacksDocument = (ownerId = "") => ownerDocumentName("lora-stacks", ownerId);

// Generous caps: enough for anyone, small enough that a bad client cannot bloat the document.
const maxOpsPerRequest = 500;
const maxRatings = 2000;

// Ratings are stored as "up" and "down", which predate Like.
const storedRatings = { liked: "up", disliked: "down" };
const readRatings = { up: "liked", down: "disliked" };
const renamed = (ratings, names) =>
  Object.fromEntries(
    Object.entries(ratings && typeof ratings === "object" ? ratings : {})
      .flatMap(([name, rating]) => (name.trim() && names[rating] ? [[name, names[rating]]] : []))
      .slice(0, maxRatings),
  );

export function loadLoraLibrary(ownerId = "") {
  const library = readRuntimeDocument(dataDir, stacksDocument(ownerId))?.library;
  return library ? { ratings: renamed(library.ratings, readRatings) } : null;
}

/**
 * Applies a batch of rating edits in order and returns the library as it now stands. Each is safe
 * to replay: ratings are set rather than toggled.
 */
export function applyLoraOps(ops, ownerId = "") {
  if (!Array.isArray(ops)) throw new Error("Expected a list of LoRA library changes.");
  const { ratings } = loadLoraLibrary(ownerId) || { ratings: {} };
  for (const op of ops.slice(0, maxOpsPerRequest)) {
    const name = String(op?.name || "").trim();
    if (op?.op !== "rating" || !name) continue;
    if (op.rating === "liked" || op.rating === "disliked") ratings[name] = op.rating;
    else delete ratings[name];
  }
  writeRuntimeDocument(dataDir, stacksDocument(ownerId), {
    library: { ratings: renamed(ratings, storedRatings) },
  });
  return { ratings };
}

/** Forgets the account's LoRA ratings. */
export function clearLoraState(ownerId = "") {
  writeRuntimeDocument(dataDir, stacksDocument(ownerId), { library: null });
}

/**
 * Takes a removed LoRA file out of every account's ratings and every saved preset
 * (library/routes.js, Remove).
 */
export function forgetLora(name, directory = dataDir) {
  for (const document of ownerDocuments(directory, "lora-stacks")) {
    const ratings = document.value?.library?.ratings;
    if (!ratings || !Object.hasOwn(ratings, name)) continue;
    delete ratings[name];
    writeRuntimeDocument(directory, document.name, document.value);
  }
  const db = runtimeDatabase(directory);
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'studio_user_presets'").get()) return;
  const update = db.prepare("UPDATE studio_user_presets SET record = ? WHERE id = ?");
  for (const row of db.prepare("SELECT id, record FROM studio_user_presets").all()) {
    const preset = JSON.parse(row.record);
    if (!preset.input?.loras?.some((item) => item?.name === name)) continue;
    preset.input.loras = preset.input.loras.filter((item) => item?.name !== name);
    update.run(JSON.stringify(preset), row.id);
  }
}
