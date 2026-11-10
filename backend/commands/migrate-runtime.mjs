import { parseArgs } from "node:util";
import path from "node:path";
import { restoreRuntimeBackup } from "../persistence/migration.ts";
import { runtimeMigrations } from "../runtime-migrations.js";
const { values } = parseArgs({
  options: {
    apply: { type: "boolean" },
    "data-dir": { type: "string" },
    destination: { type: "string" },
    "dream-owner": { type: "string" },
    restore: { type: "string" },
  },
});
if (!values["data-dir"] && !values.restore)
  throw new Error(
    "Provide --data-dir for an offline migration, or --restore and --destination for a restore rehearsal.",
  );
if (values.restore && !values.destination)
  throw new Error("--restore requires --destination (an empty directory)");

let result;
if (values.restore)
  result = restoreRuntimeBackup(path.resolve(values.restore), path.resolve(values.destination));
else
  result = await runtimeMigrations(path.resolve(values["data-dir"]), {
    apply: values.apply,
    dreamOwner: values["dream-owner"],
  });
console.log(JSON.stringify(result, null, 2));
// A step that finds conflicts applies nothing; the exit code makes that visible to scripts.
if (Object.values(result).some((step) => step?.conflicts?.length)) process.exitCode = 1;
