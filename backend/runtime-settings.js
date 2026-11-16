import { savedDocument, writeRuntimeDocument } from "./persistence/runtime.ts";

/**
 * The migrate-runtime step that drops the automatic GPU control settings (automatic, Idle After,
 * Run When Idle, Let Everyone Swap Models) from the `runtime-operations` document; Studio no longer
 * switches GPU workloads on its own. Needs Studio stopped: the runtime controller holds the
 * document and writes it back whole. Plans by default; `apply` writes. A second run finds nothing.
 */
export function runtimeSettings(dataDir, { apply = false } = {}) {
  const record = savedDocument(dataDir, "runtime-operations");
  if (!record?.settings) return { applied: apply, settings: 0 };
  if (!apply) return { applied: false, settings: 1 };
  const { settings: _settings, ...rest } = record;
  writeRuntimeDocument(dataDir, "runtime-operations", rest);
  return { applied: true, settings: 1 };
}
