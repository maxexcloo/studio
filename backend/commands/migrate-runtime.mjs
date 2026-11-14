import path from "node:path";
import { parseArgs } from "node:util";

import { runtimeMigrations } from "../runtime-migrations.js";
const { values } = parseArgs({
  options: {
    apply: { type: "boolean" },
    "data-dir": { type: "string" },
    "dream-owner": { type: "string" },
  },
});
if (!values["data-dir"]) throw new Error("Provide --data-dir for an offline migration.");

const result = await runtimeMigrations(path.resolve(values["data-dir"]), {
  apply: values.apply,
  dreamOwner: values["dream-owner"],
});
console.log(JSON.stringify(result, null, 2));
// A step that finds conflicts applies nothing; the exit code makes that visible to scripts.
if (Object.values(result).some((step) => step?.conflicts?.length)) process.exitCode = 1;
