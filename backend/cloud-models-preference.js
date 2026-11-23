import { ownerDocuments, writeRuntimeDocument } from "./persistence/runtime.ts";

/**
 * The migrate-runtime step that removes each account's retired Cloud Models preference
 * (`cloudModels`), which no control sets; the group's Cloud Models grant alone decides. Safe while
 * Studio runs; account-preferences.js reloads after it. Plans by default; `apply` writes. A second
 * run finds nothing.
 */
export function cloudModelsPreference(dataDir, { apply = false } = {}) {
  const changed = ownerDocuments(dataDir, "preferences").flatMap(({ name, value }) => {
    if (!value || !Object.hasOwn(value, "cloudModels")) return [];
    const { cloudModels: _retired, ...kept } = value;
    return [{ name, value: kept }];
  });
  if (apply) for (const { name, value } of changed) writeRuntimeDocument(dataDir, name, value);
  return { applied: apply, accounts: changed.length };
}
