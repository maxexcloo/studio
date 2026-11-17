import { ownerDocuments, writeRuntimeDocument } from "./persistence/runtime.ts";

/**
 * The migrate-runtime step that moves each account's Prompt Assistant pick (`writingModel`) to
 * its Text default on the pick's side, with Text running there, and its Videos tier (Fast or
 * Quality) to Local, whose default model is then Animate's own pick. Safe while Studio runs;
 * account-preferences.js reloads after it. Plans by default; `apply` writes. A second run finds
 * nothing.
 */
export function whereWorkRuns(dataDir, { apply = false } = {}) {
  const changed = ownerDocuments(dataDir, "preferences").flatMap(({ name, value }) => {
    const { writingModel, ...next } = value ?? {};
    const tier = ["fast", "quality"].includes(next.videos);
    if (writingModel === undefined && !tier) return [];
    if (typeof writingModel === "string" && writingModel) {
      const side = writingModel.startsWith("local/") ? "local" : "cloud";
      next.text = side;
      next[side === "local" ? "textLocal" : "textCloud"] = writingModel;
    }
    if (tier) next.videos = "local";
    return [{ name, value: next }];
  });
  if (apply) for (const { name, value } of changed) writeRuntimeDocument(dataDir, name, value);
  return { applied: apply, accounts: changed.length };
}
