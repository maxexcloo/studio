import { ownerDocuments, writeRuntimeDocument } from "./persistence/runtime.ts";
import { isObject } from "./values.js";

/**
 * The migrate-runtime step that drops Spicy Prompts from each account's `preferences` document:
 * Uncensored Models alone now decides explicit wording, so an account keeps its Uncensored Models
 * choice whatever Spicy Prompts said. Plans by default; `apply` writes. A second run finds nothing.
 */
export function spicyPrompts(dataDir, { apply = false } = {}) {
  const changed = ownerDocuments(dataDir, "preferences").flatMap(({ name, value }) => {
    if (!isObject(value) || !Object.hasOwn(value, "spicyPrompts")) return [];
    const { spicyPrompts: _dropped, ...kept } = value;
    return [{ name, kept }];
  });
  if (apply) for (const { name, kept } of changed) writeRuntimeDocument(dataDir, name, kept);
  return { applied: apply, accounts: changed.length };
}
