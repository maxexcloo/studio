import { maxTasteRule, tasteLimits } from "../shared/taste.ts";
import { ownerDocuments, savedDocument, writeRuntimeDocuments } from "./persistence/runtime.ts";

/**
 * The migrate-runtime step that removes each account's retired chat brief (`chatBrief` in its
 * preferences). What its taste can hold moves there first, after the person's own entries and up
 * to the taste limits: favourite models (`profiles`) and LoRAs, and each line of its rules short
 * enough to be a rule. `dropped` counts what goes: entries that didn't fit and the brief's other
 * fields. Plans by default; `apply` writes. A second run finds nothing.
 */
export function chatBriefRemoval(dataDir, { apply = false } = {}) {
  let dropped = 0;
  const changed = ownerDocuments(dataDir, "preferences").flatMap(({ name, value }) => {
    if (!value || !Object.hasOwn(value, "chatBrief")) return [];
    const { chatBrief: brief, ...kept } = value;
    const owner = name.slice("preferences:".length);
    const lines = String(brief?.rules || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const rules = lines.filter((line) => line.length <= maxTasteRule);
    dropped += lines.length - rules.length;
    dropped += ["subjects", "ethnicity", "age", "body", "styles"].filter(
      (key) => brief?.[key],
    ).length;
    const moves = [
      ["models", brief?.profiles ?? []],
      ["loras", brief?.loras ?? []],
      ["rules", rules],
    ].filter(([, entries]) => entries.length);
    if (!moves.length) return [{ name, value: kept }];
    const taste = savedDocument(dataDir, `taste:${owner}`) ?? {};
    const preferences = { ...taste.preferences };
    for (const [field, entries] of moves) {
      const all = [...new Set([...(preferences[field] ?? []), ...entries])];
      dropped += Math.max(0, all.length - tasteLimits[field]);
      preferences[field] = all.slice(0, tasteLimits[field]);
    }
    return [
      { name, value: kept },
      { name: `taste:${owner}`, value: { ...taste, preferences } },
    ];
  });
  if (apply && changed.length)
    writeRuntimeDocuments(
      dataDir,
      changed.map(({ name, value }) => [name, value]),
    );
  return {
    applied: apply,
    accounts: changed.filter(({ name }) => name.startsWith("preferences:")).length,
    dropped,
  };
}
