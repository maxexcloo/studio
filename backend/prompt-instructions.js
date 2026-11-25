import path from "node:path";

import { promptVariable, promptVariables } from "../shared/prompt-variables.ts";
import { currentDataDir } from "./data-dir.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { conflict, hashOf, versionsIn, writeVersion } from "./profile/store.js";
import { promptInstructionDefaults } from "./prompt-instruction-defaults.js";
import { promptInstructionUsedBy } from "./prompt-instruction-used-by.js";

const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const maxInstructionLength = 24_000;

function createPromptInstructionStore({ dataDir = currentDataDir() } = {}) {
  const root = path.join(dataDir, "history", "prompt-instructions");
  const dir = (id) => path.join(root, id);
  const defaultsFile = path.join(root, "defaults.json");
  let defaults;
  try {
    defaults = readJsonFile(defaultsFile);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const current = new Map();
  function definition(id) {
    if (!Object.hasOwn(promptInstructionDefaults, id))
      throw failure("That prompt instruction was not found.", 404);
    return promptInstructionDefaults[id];
  }
  const version = (id, number) => readJsonFile(path.join(dir(id), `${number}.json`));
  function get(id) {
    if (current.has(id)) return current.get(id);
    const { text: bundled, ...details } = definition(id);
    const baseline = defaults?.instructions[id];
    const initial = baseline?.text ?? bundled;
    const number = versionsIn(dir(id)).at(-1);
    const saved = number && (!baseline || number > baseline.version) ? version(id, number) : null;
    const text = saved?.useDefault ? initial : (saved?.text ?? initial);
    const editedAt = saved?.at ?? (baseline && defaults.at);
    const record = Object.freeze({
      id,
      ...details,
      usedBy: promptInstructionUsedBy[id],
      text,
      initial,
      hash: hashOf({ text, initial, number }),
      version: number ?? null,
      isDefault: text === initial,
      ...(editedAt ? { editedAt } : {}),
    });
    current.set(id, record);
    return record;
  }
  function save(id, text, { by = "", baseHash } = {}) {
    const saved = get(id);
    if (baseHash !== saved.hash)
      throw conflict(
        "The prompt changed since you opened it. Reload it, then make your edit again.",
      );
    if (typeof text !== "string" || !text.trim() || text.length > maxInstructionLength)
      throw failure(`Enter prompt text of up to ${maxInstructionLength} characters.`);
    const required = promptVariables(saved.initial);
    if (JSON.stringify(promptVariables(text)) !== JSON.stringify(required))
      throw failure(
        `Keep the placeholders from the default prompt: ${required.map((name) => `{{${name}}}`).join(", ") || "(none)"}.`,
      );
    if (text === saved.text) return saved;
    const number = (saved.version || 0) + 1;
    writeVersion(dir(id), number, {
      version: number,
      text,
      by,
      at: new Date().toISOString(),
      ...(text === saved.initial ? { useDefault: true } : {}),
    });
    current.delete(id);
    return get(id);
  }
  return {
    list: () => Object.keys(promptInstructionDefaults).map(get),
    adoptDefaults() {
      const listed = Object.keys(promptInstructionDefaults).map(get);
      if (defaults && listed.every(({ id, isDefault }) => isDefault && defaults.instructions[id]))
        return { at: defaults.at, count: listed.length };
      // The snapshot resets every instruction in one write without deleting its existing versions.
      const next = {
        at: new Date().toISOString(),
        instructions: Object.fromEntries(
          listed.map(({ id, text, version }) => [id, { text, version: version ?? 0 }]),
        ),
      };
      writeJsonFile(defaultsFile, next);
      defaults = next;
      current.clear();
      return { at: next.at, count: listed.length };
    },
    get,
    save,
    history(id) {
      definition(id);
      return versionsIn(dir(id))
        .reverse()
        .map((number) => version(id, number));
    },
  };
}

const stores = new Map();
export function promptInstructionStore() {
  const dataDir = currentDataDir();
  if (!stores.has(dataDir)) stores.set(dataDir, createPromptInstructionStore({ dataDir }));
  return stores.get(dataDir);
}

/** Replace placeholders once, so literal placeholder text in request data is preserved. */
export function promptInstruction(id, values = {}) {
  const { text } = promptInstructionStore().get(id);
  return text
    .split("\n")
    .flatMap((line) => {
      const expanded = line.replace(promptVariable, (_match, name) => {
        const value = Object.hasOwn(values, name) ? values[name] : undefined;
        return value == null || value === false ? "" : String(value);
      });
      return expanded || !line ? [expanded] : [];
    })
    .join("\n");
}
