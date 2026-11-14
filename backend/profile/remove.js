/**
 * Library › Profiles › Remove Profile: an administrator's explicit removal of one profile.
 *
 * The file is recorded as the profile's last version, so its history stays and a seed never brings
 * the id back; then the file and its guide binding and negatives go. Gallery records, presets and
 * jobs keep the id and report the profile as missing; restoring means saving its last version as a
 * new profile.
 * Retiring it into a `replacement` of the same kind instead records the id as that profile's alias
 * (profile/store.js), so those records resolve to it, and moves workflow preferences and LoRA
 * stacks onto it, as merging duplicates does (profile/merge.js).
 */
import fs from "node:fs";
import path from "node:path";
import { repointLoraStacks } from "../combined-profiles.js";
import { userWorkflowsDir } from "../custom-workflows.js";
import { dataDir } from "../gallery/store.js";
import { repointWorkflowPreferences } from "../workflow-catalogue.js";
import { readEditableProfile } from "./editor.js";
import { guideStore, profileStore } from "./store.js";

const kindOf = (text) => JSON.parse(text)?.studio?.kind;

/** Removes profile `id` when `baseHash` is its current hash (409 otherwise). */
export function removeProfile(id, { baseHash = "", by = "", replacement = "" } = {}) {
  const { text, hash } = readEditableProfile(id);
  if (baseHash !== hash)
    throw Object.assign(
      new Error("This profile changed since you opened it. Reload it, then remove it again."),
      { status: 409 },
    );
  if (
    replacement &&
    (replacement === id || kindOf(readEditableProfile(replacement).text) !== kindOf(text))
  )
    throw Object.assign(new Error("Choose another profile of the same kind."), { status: 400 });
  const store = profileStore({ workflowsDir: userWorkflowsDir });
  const at = new Date().toISOString();
  store.record(id, text, { by, origin: "studio", note: "Before removing" });
  if (replacement) store.addAliases([{ from: id, to: replacement, reason: "retired" }], { by, at });
  fs.rmSync(path.join(userWorkflowsDir, `${id}.json`));
  if (replacement) {
    repointWorkflowPreferences((value) => store.canonical(value));
    repointLoraStacks(dataDir, (value) => store.canonical(value));
  }
  guideStore().moveProfileBindings({ remove: [`custom:${id}`] }, { by, note: `Removed ${id}` });
  return { removed: id, ...(replacement ? { replacement } : {}) };
}
