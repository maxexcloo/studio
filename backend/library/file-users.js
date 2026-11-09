import fs from "node:fs";
import path from "node:path";
import { userWorkflowsDir } from "../custom-workflows.js";
import { dataDir } from "../gallery/store.js";
import { ownerDocuments } from "../persistence/runtime.ts";

/** Each saved profile definition: its name, declared family and text. */
export async function profileDefinitions() {
  const names = await fs.promises.readdir(userWorkflowsDir).catch(() => []);
  const definitions = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const text = await fs.promises
      .readFile(path.join(userWorkflowsDir, name), "utf8")
      .catch(() => "");
    let block = {};
    try {
      const parsed = JSON.parse(text);
      block = parsed.studio || {};
    } catch {
      /* Unreadable definitions still count as naming the files they mention. */
    }
    definitions.push({
      name: name.replace(/\.json$/, ""),
      family: String(block.family || ""),
      text,
    });
  }
  return definitions;
}

/**
 * What still uses a model file, so an update removes the old one only when nothing does
 * (Decision 4). `presetModels` is model/catalogue.js's.
 */
export async function modelFileReferences({ file }, presetModels) {
  if (!file) return [];
  const quoted = JSON.stringify(file);
  const users = (await profileDefinitions())
    .filter((definition) => definition.text.includes(quoted))
    .map((definition) => `the ${definition.name} profile`);
  for (const profile of (await presetModels().catch(() => ({ profiles: [] }))).profiles || []) {
    if (
      [profile.defaults?.model, profile.model, profile.baseModel].includes(file) &&
      !users.includes(`the ${profile.id} profile`)
    )
      users.push(`the ${profile.displayName || profile.label || profile.id} profile`);
  }
  const saved = ownerDocuments(dataDir, "lora-stacks").filter(({ value }) =>
    JSON.stringify(value).includes(quoted),
  ).length;
  if (saved) users.push(saved === 1 ? "a saved LoRA stack" : `${saved} saved LoRA stacks`);
  return users;
}
