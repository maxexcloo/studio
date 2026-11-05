import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readJsonFile, writeJsonFile } from "../json-store.js";
import { verifiedBackup } from "../persistence/migration.ts";
import { isObject } from "../values.js";

/**
 * The migrate-runtime step that folds the catalogue's `seed` and `admin` layers (LoRA entries
 * synced from the retired lora-catalogue.json files) into the layers Studio reads, then removes
 * them. Each LoRA's merged seed and admin values (admin over seed, as Studio showed them) move
 * field by field: a value the admin layer changed or added becomes an administrator edit, any
 * other value a definition. A field the definitions or edits already hold stays as it is, as does
 * a field only the old files carried (`dropped`; nothing read it). Plans by default, listing per
 * LoRA what moves where; `apply` copies the catalogue to a `.backups/lora-layers-*` folder with its
 * mapping (restorable with `--restore`), then writes it, with Studio stopped. A second run finds
 * nothing.
 */
const text = (value, limit) => (typeof value === "string" ? value.trim().slice(0, limit) : "");
const list = (value, limit = 30, size = 120) =>
  (Array.isArray(value) ? value : [])
    .filter((item) => typeof item === "string" && item.trim() && item.trim() !== "[]")
    .map((item) => item.trim().slice(0, size))
    .slice(0, limit);
const texts = { title: 300, baseModel: 100, description: 10000, note: 500, guidance: 1000 };

/** One old-layer field as the catalogue field it was shown as, or null when it showed nothing. */
function field(name, value) {
  if (Object.hasOwn(texts, name) || name === "negative") {
    const clean = text(value, texts[name] || 500);
    return clean ? [name, clean] : null;
  }
  switch (name) {
    case "role":
    case "type":
      return typeof value === "string" && value ? [name, value] : null;
    case "modelType":
      return ["original", "finetune"].includes(value) ? [name, value] : null;
    case "uncensored":
      return typeof value === "boolean" ? [name, value] : null;
    case "triggers":
      return Array.isArray(value) ? [name, list(value)] : null;
    case "tags":
      return list(value, 10, 80).length ? [name, list(value, 10, 80)] : null;
    case "compatibility":
      return value ? [name, structuredClone(value)] : null;
    case "strengthRange":
      return isObject(value)
        ? [
            "strength",
            Object.fromEntries(
              ["default", "min", "max", "step"]
                .filter((part) => Number.isFinite(value[part]))
                .map((part) => [part, value[part]]),
            ),
          ]
        : null;
    case "sourceUrl": {
      if (typeof value !== "string" || !/^https:\/\//i.test(value)) return null;
      let host = "";
      try {
        host = new URL(value).hostname.toLowerCase();
      } catch {
        return null;
      }
      const kind =
        host === "civitai.com" || host.endsWith(".civitai.com")
          ? "civitaiCom"
          : host === "civitai.red" || host.endsWith(".civitai.red")
            ? "civitaiRed"
            : host === "huggingface.co"
              ? "hf"
              : "";
      return kind ? ["links", { [kind]: value }] : null;
    }
    default:
      return undefined;
  }
}

/** Per LoRA key, what moves to the definitions and to the edits, what stays and what is dropped. */
function plan(state) {
  const seed = isObject(state.layers.seed) ? state.layers.seed : {};
  const admin = isObject(state.layers.admin) ? state.layers.admin : {};
  const definitions = isObject(state.layers.definitions) ? state.layers.definitions : {};
  const edits = isObject(state.edits) ? state.edits : {};
  const moves = {};
  for (const key of [...new Set([...Object.keys(seed), ...Object.keys(admin)])].sort()) {
    const fromSeed = isObject(seed[key]) ? seed[key] : {};
    const fromAdmin = isObject(admin[key]) ? admin[key] : {};
    const held = { ...definitions[key], ...edits[key]?.fields };
    const move = { definitions: {}, edits: {}, kept: [], dropped: [] };
    for (const [name, value] of Object.entries({ ...fromSeed, ...fromAdmin })) {
      const moved = field(name, value);
      if (moved === undefined) move.dropped.push(name);
      if (!moved) continue;
      const [target, clean] = moved;
      if (held[target] !== undefined && held[target] !== null) {
        move.kept.push(target);
        continue;
      }
      const changedByAdmin =
        Object.hasOwn(fromAdmin, name) &&
        JSON.stringify(fromAdmin[name]) !== JSON.stringify(fromSeed[name]);
      move[changedByAdmin ? "edits" : "definitions"][target] = clean;
    }
    moves[key] = move;
  }
  return moves;
}

/** What the dry run lists per LoRA: the field names moving to each layer, kept and dropped. */
const listed = (moves) =>
  Object.fromEntries(
    Object.entries(moves).map(([key, move]) => [
      key,
      Object.fromEntries(
        Object.entries(move)
          .map(([name, value]) => [name, Array.isArray(value) ? value : Object.keys(value)])
          .filter(([, names]) => names.length),
      ),
    ]),
  );

export function loraLayers(dataDir, { apply = false } = {}) {
  const file = path.join(dataDir, "library", "catalogue.json");
  const result = { applied: false, backup: "", loras: {} };
  if (!fs.existsSync(file)) return result;
  const bytes = fs.readFileSync(file);
  const state = readJsonFile(file);
  // Releases that still read both layers save them back empty once folded.
  if (
    !isObject(state?.layers) ||
    !["seed", "admin"].some((name) => Object.keys(state.layers[name] || {}).length)
  )
    return result;
  const moves = plan(state);
  result.loras = listed(moves);
  if (!apply) return result;

  const mappings = [
    {
      source: "library/catalogue.json",
      target: "library/catalogue.json",
      hash: crypto.createHash("sha256").update(bytes).digest("hex"),
    },
  ];
  result.backup = verifiedBackup(
    dataDir,
    "lora-layers",
    [{ source: mappings[0].source, hash: mappings[0].hash, bytes }],
    { mappings, loras: result.loras },
  );
  const { seed: _seed, admin: _admin, ...layers } = state.layers;
  layers.definitions = isObject(layers.definitions) ? { ...layers.definitions } : {};
  const edits = isObject(state.edits) ? { ...state.edits } : {};
  for (const [key, move] of Object.entries(moves)) {
    if (Object.keys(move.definitions).length)
      layers.definitions[key] = { ...layers.definitions[key], ...move.definitions };
    if (!Object.keys(move.edits).length) continue;
    edits[key] = edits[key]
      ? { ...edits[key], fields: { ...edits[key].fields, ...move.edits } }
      : {
          fields: move.edits,
          origin: "admin",
          by: "",
          editedAt: state.migratedAt || new Date().toISOString(),
          history: [],
        };
  }
  // Studio rebuilds the entries from the layers and edits when it loads the catalogue.
  writeJsonFile(file, { ...state, layers, edits });
  result.applied = true;
  return result;
}
