import { ownerDocuments, writeRuntimeDocument } from "./persistence/runtime.ts";
import { isObject } from "./values.js";

/**
 * The migrate-runtime step that keeps only the LoRA ratings in each account's `lora-stacks`
 * document, dropping the saved stacks and the library's strengths and recents nothing reads any
 * more. Plans by default; `apply` writes. A second run finds nothing.
 */
export function loraStacks(dataDir, { apply = false } = {}) {
  const changed = ownerDocuments(dataDir, "lora-stacks").flatMap(({ name, value }) => {
    const library = isObject(value) && isObject(value.library) ? value.library : null;
    const kept = {
      library: library ? { ratings: isObject(library.ratings) ? library.ratings : {} } : null,
    };
    return JSON.stringify(kept) === JSON.stringify(value) ? [] : [{ name, kept }];
  });
  if (apply) for (const { name, kept } of changed) writeRuntimeDocument(dataDir, name, kept);
  return { applied: apply, accounts: changed.length };
}
