import fs from "node:fs";
import path from "node:path";

import { isObject } from "./values.js";

// Radiance 2 serves int8 builds under these ids and refuses every FP8 .rad.
const renames = {
  "fasth3-8-step-v2-fp8.rad": "fasth3-8-step-v2-i8",
  "flux-3-klein-base-fp8.rad": "flux-3-klein-base-iq8r",
  "flux-3-klein-fp8.rad": "flux-3-klein-iq8r",
  "krea-2-raw-fp8.rad": "krea-2-raw-iq8r",
  "krea-2-turbo-fp8.rad": "krea-2-turbo-iq8r",
  "kroma-0.3.1-turbo-fp8.rad": "kroma-0.3.1-turbo-iq8r",
  "kromafine-1-turbo-fp8.rad": "kromafine-1-turbo-iq8r",
  "minimax-h3-fp8.rad": "minimax-h3-i8",
  "noctq-v4-uncensored-fp8.rad": "noctq-v4-uncensored-iq8r",
  "qwen-image-2.1-fp8.rad": "qwen-image-2.1-iq8r",
  "qwen-image-2.1-turbo-fp8.rad": "qwen-image-2.1-turbo-iq8r",
  "qwen-image-2.1-turbo-uncensored-fp8.rad": "qwen-image-2.1-turbo-uncensored-iq8r",
};

/**
 * One profile with every Radiance 1 model file named anywhere in it as its Radiance 2 id. `changes`
 * lists what moved; `unknown` the .rad files with no Radiance 2 id, which stay as they are.
 */
function migrated(profile) {
  const changes = new Set();
  const unknown = new Set();
  const walk = (value) => {
    if (typeof value === "string") {
      if (renames[value]) changes.add(`${value} → ${renames[value]}`);
      else if (value.endsWith(".rad")) unknown.add(value);
      return renames[value] || value;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (!isObject(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
  };
  return { profile: walk(profile), changes: [...changes], unknown: [...unknown] };
}

/**
 * The migrate-runtime step that moves live profiles (the data folder's workflows) to Radiance 2:
 * every Radiance 1 model file a profile names becomes its Radiance 2 id. Safe while Studio runs: profiles are read from their folder on each request,
 * and a file is replaced in one rename. A second run finds nothing.
 */
export function radianceModels(dataDir, { apply = false } = {}) {
  const folder = path.join(dataDir, "workflows");
  const result = { applied: false, profiles: [], unknown: [] };
  const names = fs.existsSync(folder)
    ? fs.readdirSync(folder).filter((name) => name.endsWith(".json"))
    : [];
  const plans = names.flatMap((name) => {
    const file = path.join(folder, name);
    const plan = migrated(JSON.parse(fs.readFileSync(file, "utf8")));
    for (const model of plan.unknown) result.unknown.push(`${name}: ${model}`);
    return plan.changes.length ? [{ name, file, ...plan }] : [];
  });
  result.profiles = plans.map(({ name, changes }) => ({ name, changes }));
  if (!apply || !plans.length) return result;
  for (const { file, profile } of plans) {
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(profile, null, 2)}\n`);
    fs.renameSync(temporary, file);
  }
  result.applied = true;
  return result;
}
