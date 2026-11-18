/**
 * Library › Profiles › Remove Profile: an administrator's explicit removal of one profile.
 *
 * The file is recorded as the profile's last version, so its history stays and a seed never brings
 * the id back; then the file and its guide binding and negatives go. Gallery records, presets and
 * jobs keep the id and report the profile as missing; restoring means saving its last version as a
 * new profile.
 */
import fs from "node:fs";
import path from "node:path";

import { userWorkflowsDir } from "../custom-workflows.js";
import { readEditableProfile } from "./editor.js";
import { guideStore, profileStore } from "./store.js";

/** Removes profile `id` when `baseHash` is its current hash (409 otherwise). */
export function removeProfile(id, { baseHash = "", by = "" } = {}) {
  const { text, hash } = readEditableProfile(id);
  if (baseHash !== hash)
    throw Object.assign(
      new Error("This profile changed since you opened it. Reload it, then remove it again."),
      { status: 409 },
    );
  const store = profileStore({ workflowsDir: userWorkflowsDir });
  store.record(id, text, { by, origin: "studio", note: "Before removing" });
  fs.rmSync(path.join(userWorkflowsDir, `${id}.json`));
  guideStore().moveProfileBindings({ remove: [`custom:${id}`] }, { by, note: `Removed ${id}` });
  return { removed: id };
}
