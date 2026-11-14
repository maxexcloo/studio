import { dataDir } from "../gallery/store.js";
import {
  ownerDocumentName,
  ownerDocuments,
  readRuntimeDocument,
  runtimeDatabase,
  writeRuntimeDocument,
} from "../persistence/runtime.ts";
import { cleanTriggers } from "./catalogue.js";

/** Each account's `lora-stacks:<key>` document (runtime.ts ownerDocumentName). */
const stacksDocument = (ownerId = "") => ownerDocumentName("lora-stacks", ownerId);

// Generous caps: enough for anyone, small enough that a bad client cannot bloat the document.
const maxLorasPerStack = 8;
const maxOpsPerRequest = 500;

function readState(ownerId = "") {
  try {
    const value = readRuntimeDocument(dataDir, stacksDocument(ownerId));
    if (value?.stacks && typeof value.stacks === "object")
      return { stacks: value.stacks, library: value.library || null };
    return { stacks: value && typeof value === "object" ? value : {}, library: null };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { stacks: {}, library: null };
  }
}

function writeState(state, ownerId = "") {
  writeRuntimeDocument(dataDir, stacksDocument(ownerId), state);
}

function cleanStack(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .flatMap((item) => {
      const name = String(item?.name || "").trim();
      if (!name || seen.has(name)) return [];
      seen.add(name);
      return [
        {
          name,
          enabled: item?.enabled !== false,
          strength: Number.isFinite(Number(item?.strength)) ? Number(item.strength) : 0.7,
          triggers: Array.isArray(item?.triggers)
            ? cleanTriggers(item.triggers)
            : item?.triggers !== false,
        },
      ];
    })
    .slice(0, maxLorasPerStack);
}

function cleanNames(value, limit = 500) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, limit)
    : [];
}

/** Workflows left with no strengths drop out, so emptied ones clear themselves. */
const withoutEmpty = (entries) =>
  Object.fromEntries(entries.filter(([, value]) => Object.keys(value).length));

function cleanStrengths(value) {
  const source = value && typeof value === "object" ? value : {};
  return withoutEmpty(
    Object.entries(source).map(([workflow, entries]) => [
      workflow,
      Object.fromEntries(
        Object.entries(entries && typeof entries === "object" ? entries : {})
          .filter(([, strength]) => Number.isFinite(Number(strength)))
          .map(([name, strength]) => [name, Number(strength)]),
      ),
    ]),
  );
}

/** Thumbs up or down per LoRA file; anything else is unrated and left out. */
function cleanRatings(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    Object.entries(source)
      .filter(([name, rating]) => name.trim() && (rating === "up" || rating === "down"))
      .slice(0, 2000),
  );
}

function cleanLibrary(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    strengths: cleanStrengths(source.strengths),
    ratings: cleanRatings(source.ratings),
    recents: cleanNames(source.recents, 12),
  };
}

export function loadLoraStack(workflowId, ownerId = "") {
  const value = readState(ownerId).stacks[String(workflowId || "")];
  return Array.isArray(value) ? cleanStack(value) : null;
}

export function saveLoraStack(workflowId, stack, ownerId = "") {
  const id = String(workflowId || "").trim();
  if (!id) throw new Error("A workflow is required to save a LoRA stack.");
  const state = readState(ownerId);
  state.stacks[id] = cleanStack(stack);
  writeState(state, ownerId);
  return state.stacks[id];
}

export function loadLoraLibrary(ownerId = "") {
  const library = readState(ownerId).library;
  return library ? cleanLibrary(library) : null;
}

/**
 * Folds another copy of the library into this one without losing anything: recents are joined;
 * ratings and strengths fill in only what is not set yet. Used for the whole-library PUT a
 * device's first sync sends.
 */
function mergeLibrary(into, incoming) {
  const other = cleanLibrary(incoming);
  into.ratings = { ...other.ratings, ...into.ratings };
  into.recents = [...new Set([...into.recents, ...other.recents])].slice(0, 12);
  for (const [workflow, entries] of Object.entries(other.strengths)) {
    into.strengths[workflow] = { ...entries, ...into.strengths[workflow] };
  }
}

/** One edit, applied to whatever the server holds right now. Each is safe to replay: ratings are set rather than toggled. */
function applyOp(state, library, op) {
  switch (op?.op) {
    case "strengths": {
      const workflow = String(op.workflowId || "");
      if (workflow)
        library.strengths[workflow] = {
          ...library.strengths[workflow],
          ...cleanStrengths({ x: op.values }).x,
        };
      break;
    }
    case "rating": {
      const name = String(op.name || "").trim();
      if (!name) break;
      if (op.rating === "up" || op.rating === "down") library.ratings[name] = op.rating;
      else delete library.ratings[name];
      break;
    }
    case "recents": {
      const added = cleanNames(op.names, 12);
      library.recents = [
        ...added,
        ...library.recents.filter((item) => !added.includes(item)),
      ].slice(0, 12);
      break;
    }
    case "active": {
      const workflow = String(op.workflowId || "").trim();
      if (workflow) state.stacks[workflow] = cleanStack(op.loras);
      break;
    }
    case "merge":
      mergeLibrary(library, op.library);
      break;
    default:
      break;
  }
}

/** Applies a batch of edits in order and returns the library as it now stands. */
export function applyLoraOps(ops, ownerId = "") {
  if (!Array.isArray(ops)) throw new Error("Expected a list of LoRA library changes.");
  const state = readState(ownerId);
  const library = cleanLibrary(state.library);
  for (const op of ops.slice(0, maxOpsPerRequest)) applyOp(state, library, op);
  // Keeps what this build no longer reads, such as saved stacks the stackPresets step has yet to move.
  state.library = { ...state.library, ...cleanLibrary(library) };
  writeState(state, ownerId);
  return cleanLibrary(state.library);
}

/** Whole-library saves merge rather than replace, so a stale device cannot erase another's stacks. */
export function saveLoraLibrary(library, ownerId = "") {
  return applyLoraOps([{ op: "merge", library }], ownerId);
}

/** Forgets the active stacks and the library (used by "Reset all settings"). */
export function clearLoraState(ownerId = "") {
  writeState({ stacks: {}, library: null }, ownerId);
}

/**
 * Takes a removed LoRA file out of every account's stacks, strengths, ratings and recents, and out
 * of every saved preset (library/routes.js, Remove).
 */
export function forgetLora(name, directory = dataDir) {
  const without = (list) =>
    Array.isArray(list) ? list.filter((item) => item?.name !== name) : list;
  for (const document of ownerDocuments(directory, "lora-stacks")) {
    const before = JSON.stringify(document.value);
    const state = JSON.parse(before);
    const stacks = state?.stacks && typeof state.stacks === "object" ? state.stacks : state;
    for (const key of Object.keys(stacks || {}))
      if (Array.isArray(stacks[key])) stacks[key] = without(stacks[key]);
    const library = state?.library;
    if (library && typeof library === "object") {
      for (const entries of Object.values(library.strengths || {}))
        if (entries) delete entries[name];
      if (library.ratings) delete library.ratings[name];
      if (Array.isArray(library.recents))
        library.recents = library.recents.filter((item) => item !== name);
    }
    if (JSON.stringify(state) !== before) writeRuntimeDocument(directory, document.name, state);
  }
  const db = runtimeDatabase(directory);
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'studio_user_presets'").get()) return;
  const update = db.prepare("UPDATE studio_user_presets SET record = ? WHERE id = ?");
  for (const row of db.prepare("SELECT id, record FROM studio_user_presets").all()) {
    const preset = JSON.parse(row.record);
    if (!preset.input?.loras?.some((item) => item?.name === name)) continue;
    preset.input.loras = without(preset.input.loras);
    update.run(JSON.stringify(preset), row.id);
  }
}
