import { parseArgs } from "node:util";
import path from "node:path";
import {
  migrateGalleryRows,
  migrateRuntime,
  restoreRuntimeBackup,
} from "../persistence/migration.ts";
import { combinedProfiles } from "../combined-profiles.js";
import { dreamOwnership } from "../dream-ownership.js";
import { loraRatings } from "../lora-ratings.js";
import { uncensoredMarker, upscaleFeature } from "../uncensored-marker.js";
import { migrateUploads } from "../uploads.js";
import { versionSources } from "../version-sources.js";
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
else {
  const dataDir = path.resolve(values["data-dir"]);
  result = {
    runtime: migrateRuntime(dataDir, { apply: values.apply }),
    galleryRows: migrateGalleryRows(dataDir, { apply: values.apply }),
    uploads: migrateUploads(dataDir, { apply: values.apply }),
    combinedProfiles: combinedProfiles(dataDir, { apply: values.apply }),
    uncensoredMarker: uncensoredMarker(dataDir, { apply: values.apply }),
    upscaleFeature: upscaleFeature(dataDir, { apply: values.apply }),
    loraRatings: loraRatings(dataDir, { apply: values.apply }),
    versionSources: versionSources(dataDir, { apply: values.apply }),
    ...(values["dream-owner"]
      ? {
          dreamOwnership: dreamOwnership(dataDir, {
            owner: values["dream-owner"],
            apply: values.apply,
          }),
        }
      : {}),
  };
}
console.log(JSON.stringify(result, null, 2));
if (
  result.conflicts?.length ||
  result.runtime?.conflicts.length ||
  result.galleryRows?.conflicts.length ||
  result.uploads?.conflicts.length
)
  process.exitCode = 1;
