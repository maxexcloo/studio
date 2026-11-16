import { ownerDocuments, writeRuntimeDocument } from "./persistence/runtime.ts";

/**
 * The migrate-runtime step that folds each taste profile's separate Always Avoid list
 * (`addedAvoid`) into its Dislikes: where the list held anything, the person's own Dislikes
 * become it followed by the Dislikes that stood before (theirs, else what Studio learnt), so
 * nothing they avoided drops out. Plans by default; `apply` writes. A second run finds nothing.
 */
export function tasteDislikes(dataDir, { apply = false } = {}) {
  const changed = ownerDocuments(dataDir, "taste").flatMap(({ name, value }) => {
    if (!value || !Object.hasOwn(value, "addedAvoid")) return [];
    const { addedAvoid, ...kept } = value;
    if (addedAvoid?.length) {
      const before = kept.preferences?.avoid ?? kept.avoid ?? [];
      const seen = new Set();
      kept.preferences = {
        ...kept.preferences,
        avoid: [...addedAvoid, ...before].filter((entry) => {
          const key = entry.toLowerCase();
          return !seen.has(key) && seen.add(key);
        }),
      };
    }
    return [{ name, kept }];
  });
  if (apply) for (const { name, kept } of changed) writeRuntimeDocument(dataDir, name, kept);
  return { applied: apply, accounts: changed.length };
}
