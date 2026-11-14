import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { databaseFile, ownerDocumentName, runtimeDatabase } from "./persistence/runtime.ts";
import { isObject } from "./values.js";

/**
 * The migrate-runtime step that turns each account's saved LoRA stacks (`library.snapshots` in its
 * `lora-stacks` document, keyed `family:<family>`) into presets holding only LoRAs: the stack's
 * LoRAs in order with their strengths, enabled state and trigger words, its family, its name (a
 * name the account already uses gains a number) and when it was saved. The stacks then leave the
 * document. A document whose account is gone is left as it is and listed. Safe while Studio runs:
 * presets and stacks are read from the database on each request. A second run finds nothing.
 */
export function stackPresets(dataDir, { apply = false } = {}) {
  const result = { applied: false, accounts: 0, stacks: 0, orphaned: [], examples: [] };
  if (!fs.existsSync(databaseFile(dataDir))) return result;
  const db = runtimeDatabase(dataDir);
  const document = (name) => {
    const row = db.prepare("SELECT value FROM studio_documents WHERE name = ?").get(name);
    return row ? JSON.parse(String(row.value)) : undefined;
  };
  const owners = new Map(
    ["", ...(document("accounts")?.accounts || []).map((account) => account.id)].map((id) => [
      ownerDocumentName("lora-stacks", id),
      id,
    ]),
  );
  const plans = db
    .prepare("SELECT name, value FROM studio_documents WHERE substr(name, 1, 12) = 'lora-stacks:'")
    .all()
    .map((row) => ({ name: String(row.name), state: JSON.parse(String(row.value)) }))
    .filter(({ state }) => isObject(state?.library?.snapshots))
    .flatMap(({ name, state }) => {
      if (!owners.has(name)) {
        result.orphaned.push(name);
        return [];
      }
      const stacks = Object.entries(state.library.snapshots).flatMap(([key, list]) =>
        (Array.isArray(list) ? list : []).map((stack) => ({
          family: key.replace(/^family:/, ""),
          stack,
        })),
      );
      return [{ name, owner: owners.get(name), state, stacks }];
    });
  result.accounts = plans.length;
  result.stacks = plans.reduce((total, plan) => total + plan.stacks.length, 0);
  result.examples = plans
    .flatMap((plan) => plan.stacks.map(({ family, stack }) => ({ family, name: stack.name })))
    .slice(0, 5);
  if (!apply || !plans.length) return result;
  const presets = db.prepare("SELECT record FROM studio_user_presets WHERE owner_id = ?");
  const insert = db.prepare("INSERT INTO studio_user_presets VALUES (?, ?, ?)");
  const write = db.prepare("UPDATE studio_documents SET value = ? WHERE name = ?");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const { name, owner, state, stacks } of plans) {
      const taken = new Set(
        presets.all(owner).map((row) => JSON.parse(String(row.record)).title.toLocaleLowerCase()),
      );
      for (const { family, stack } of stacks) {
        const base = String(stack.name || "").trim() || "LoRA Stack";
        let title = base;
        for (let count = 2; taken.has(title.toLocaleLowerCase()); count++)
          title = `${base} ${count}`;
        taken.add(title.toLocaleLowerCase());
        const preset = {
          id: randomUUID(),
          title,
          input: { loras: Array.isArray(stack.loras) ? stack.loras : [] },
          savedAt: stack.savedAt || new Date().toISOString(),
          parts: ["loras"],
          family,
        };
        insert.run(preset.id, owner, JSON.stringify(preset));
      }
      const { snapshots: _, ...library } = state.library;
      write.run(JSON.stringify({ ...state, library }), name);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  result.applied = true;
  return result;
}
