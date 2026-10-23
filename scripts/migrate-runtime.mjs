import { parseArgs } from "node:util";
import path from "node:path";
import { migrateRuntime, restoreRuntimeBackup } from "../server/persistence/migration.ts";
const { values } = parseArgs({
  options: {
    apply: { type: "boolean" },
    "data-dir": { type: "string" },
    restore: { type: "string" },
    destination: { type: "string" },
  },
});
if (!values["data-dir"] && !values.restore)
  throw new Error(
    "Provide --data-dir for an offline migration, or --restore and --destination for a restore rehearsal.",
  );
if (values.restore && !values.destination)
  throw new Error("--restore requires --destination (an empty directory)");
const result = values.restore
  ? restoreRuntimeBackup(path.resolve(values.restore), path.resolve(values.destination))
  : migrateRuntime(path.resolve(values["data-dir"]), { apply: values.apply });
console.log(JSON.stringify(result, null, 2));
if (result.conflicts?.length) process.exitCode = 1;
