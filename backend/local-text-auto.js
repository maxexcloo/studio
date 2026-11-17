import { ownerDocuments, writeRuntimeDocument } from "./persistence/runtime.ts";

/**
 * The migrate-runtime step that moves each account's Text Local default from `local/uncensored`,
 * which Bifrost no longer serves, to `local/auto`, which is uncensored itself. Safe while Studio
 * runs; account-preferences.js reloads after it. Plans by default; `apply` writes. A second run
 * finds nothing.
 */
export function localTextAuto(dataDir, { apply = false } = {}) {
  const changed = ownerDocuments(dataDir, "preferences")
    .filter(({ value }) => value?.textLocal === "local/uncensored")
    .map(({ name, value }) => ({ name, value: { ...value, textLocal: "local/auto" } }));
  if (apply) for (const { name, value } of changed) writeRuntimeDocument(dataDir, name, value);
  return { applied: apply, accounts: changed.length };
}
