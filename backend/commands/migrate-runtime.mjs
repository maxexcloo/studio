import { parseArgs } from "node:util";
import path from "node:path";
import { migrateRuntime, restoreRuntimeBackup } from "../persistence/migration.ts";
import { remapProfileIds } from "../persistence/profile-ids.ts";
import { applyStudioNames, planStudioNames, undoStudioNames } from "../persistence/studio-names.ts";
const { values } = parseArgs({
  options: {
    apply: { type: "boolean" },
    "data-dir": { type: "string" },
    destination: { type: "string" },
    "media-dir": { type: "string" },
    "output-dir": { type: "string" },
    restore: { type: "string" },
    undo: { type: "string" },
  },
});
if (!values["data-dir"] && !values.restore && !values.undo)
  throw new Error(
    "Provide --data-dir for an offline migration, --undo with a names backup, or --restore and --destination for a restore rehearsal.",
  );
if (values.restore && !values.destination)
  throw new Error("--restore requires --destination (an empty directory)");

let result;
if (values.restore)
  result = restoreRuntimeBackup(path.resolve(values.restore), path.resolve(values.destination));
else if (values.undo) result = undoStudioNames(path.resolve(values.undo));
else {
  const dataDir = path.resolve(values["data-dir"]);
  const options = {
    mediaDir: path.resolve(values["media-dir"] || path.join(dataDir, "media")),
    outputDir: values["output-dir"] ? path.resolve(values["output-dir"]) : undefined,
  };
  const runtime = migrateRuntime(dataDir, { apply: values.apply });
  const ready = runtime.applied || runtime.alreadyMigrated;
  let names;
  if (values.apply && ready) names = applyStudioNames(dataDir, options);
  else {
    const { changes: _changes, ...plan } = planStudioNames(dataDir, options);
    names = { ...plan, applied: false };
  }
  result = { runtime, names, profileIds: remapProfileIds(dataDir, { apply: values.apply }) };
}
console.log(JSON.stringify(result, null, 2));
if (result.conflicts?.length || result.runtime?.conflicts.length || result.names?.conflicts.length)
  process.exitCode = 1;
