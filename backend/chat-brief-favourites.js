import { tasteLimits } from "../shared/taste.ts";
import { ownerDocuments, savedDocument, writeRuntimeDocument } from "./persistence/runtime.ts";

const fields = [
  ["profiles", "models"],
  ["loras", "loras"],
];

/**
 * The migrate-runtime step that moves each chat brief's favourite models (`profiles`) and LoRAs
 * into the person's own taste Models and LoRAs: their own entries first, then the brief's, up to
 * the taste limit (`dropped` counts what didn't fit), and drops them from the brief. Plans by
 * default; `apply` writes. A second run finds nothing.
 */
export function chatBriefFavourites(dataDir, { apply = false } = {}) {
  let dropped = 0;
  const changed = ownerDocuments(dataDir, "preferences").flatMap(({ name, value }) => {
    const brief = value?.chatBrief;
    if (!brief || !fields.some(([key]) => Object.hasOwn(brief, key))) return [];
    const owner = name.slice("preferences:".length);
    const taste = savedDocument(dataDir, `taste:${owner}`) ?? {};
    const preferences = { ...taste.preferences };
    const kept = { ...brief };
    for (const [key, field] of fields) {
      delete kept[key];
      if (!brief[key]?.length) continue;
      const all = [...new Set([...(preferences[field] ?? []), ...brief[key]])];
      dropped += Math.max(0, all.length - tasteLimits[field]);
      preferences[field] = all.slice(0, tasteLimits[field]);
    }
    return [
      { name, value: { ...value, chatBrief: kept } },
      { name: `taste:${owner}`, value: { ...taste, preferences } },
    ];
  });
  if (apply) for (const { name, value } of changed) writeRuntimeDocument(dataDir, name, value);
  return { applied: apply, accounts: changed.length / 2, dropped };
}
