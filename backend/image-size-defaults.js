import fs from "node:fs";
import path from "node:path";

import { writeBytesFile } from "./json-store.js";
import { createProfileStore } from "./profile/store.js";

const from = { width: 1536, height: 2048 };
const to = { width: 768, height: 1024 };

/** Each `defaults` object at the 2K size takes the 1K one; returns how many changed. */
function resized(value) {
  if (!value || typeof value !== "object") return 0;
  let count = 0;
  for (const [key, child] of Object.entries(value)) {
    if (key === "defaults" && child?.width === from.width && child?.height === from.height) {
      Object.assign(child, to);
      count++;
    } else count += resized(child);
  }
  return count;
}

/**
 * The migrate-runtime step that sets the Krea 2 family's image profiles (Krea 2, Kroma and
 * Kromafine) to draw 1K by default: each `defaults` at 1536×2048 becomes 768×1024 and the
 * descriptions say so, each changed profile saved as a new version. Sizes a person or a saved
 * preset chose stay. Safe while Studio runs: it reads profile files as they change. Plans by
 * default; `apply` writes. A second run finds nothing.
 */
export function imageSizeDefaults(dataDir, { apply = false } = {}) {
  const dir = path.join(dataDir, "workflows");
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((name) => name.endsWith(".json"))
    : [];
  const profiles = [];
  for (const name of files) {
    const file = path.join(dir, name);
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const profile = raw.studio;
    if (profile?.kind !== "image" || profile.family !== "krea2" || !resized(raw)) continue;
    profiles.push(profile.id);
    if (!apply) continue;
    const text = `${JSON.stringify(raw, null, 2).replaceAll(
      `Default: ${from.width}×${from.height}`,
      `Default: ${to.width}×${to.height}`,
    )}\n`;
    writeBytesFile(file, text);
    createProfileStore({ dataDir, workflowsDir: dir }).record(profile.id, text, {
      by: "migrate-runtime",
      note: "Default size 1K",
    });
  }
  return { applied: apply, profiles };
}
