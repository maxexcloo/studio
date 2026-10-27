// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio is the only writer of live profiles. The sample profiles in `backend/samples/` seed a
 * data folder that has never held one (a new install or local development); once Studio holds
 * any profile, or has held one, nothing is copied again.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const samplesDirectory = fileURLToPath(new URL("./samples/", import.meta.url));

const profileFiles = (dir) => {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json") && !name.startsWith("."))
      .sort();
  } catch {
    return [];
  }
};

/** Copies the samples into an empty data folder through the profile `store`; returns their ids. */
export function seedSamples({
  dataDir,
  workflowsDir = path.join(dataDir, "workflows"),
  samplesDir = samplesDirectory,
  store,
  log = console,
}) {
  // Profile history outlives a removed profile, so a folder that ever held one has some.
  const held = fs.existsSync(path.join(dataDir, "history", "profiles"));
  if (held || profileFiles(workflowsDir).length) return [];
  const added = [];
  for (const name of profileFiles(samplesDir)) {
    const text = fs.readFileSync(path.join(samplesDir, name), "utf8");
    fs.mkdirSync(workflowsDir, { recursive: true });
    fs.writeFileSync(path.join(workflowsDir, name), text, { flag: "wx" });
    const id = name.slice(0, -5);
    store.record(id, text, { origin: "seed", by: "seed", note: "Sample profile" });
    added.push(id);
  }
  if (added.length) log.info?.(`[seed] Added the sample profiles: ${added.join(", ")}.`);
  return added;
}
