import fs from "node:fs";
import path from "node:path";
import { readJsonFile } from "./json-store.js";
import { verifiedBackup } from "./persistence/migration.ts";
import {
  ownerDocumentFile,
  ownerDocuments,
  runtimeDatabase,
  savedDocument,
  withOfflineDatabase,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";
import { createProfileStore } from "./profile/store.js";
import { digest, isObject } from "./values.js";

/**
 * The migrate-runtime step that rewrites records older builds left in shapes Studio no longer
 * reads:
 * - `loraStacks`: saved LoRA stacks keyed by a profile id (in every `lora-stacks:<key>`) move to
 *   that profile's family key (`family:<family>`), as stacks are saved now. A key whose profile
 *   file is gone is listed under `unresolved` and left as it is.
 * - `modelChoices`: the coarse "Use as" types in the `model-types` document become today's families
 *   (`z-image` → `zimage`, `wan` → `wan22_5b`); `checkpoint`, which chose nothing, goes.
 * - `galleryReferences`: gallery rows lose the single-reference keys (`startImageId`,
 *   `referenceImage`, `referenceImageName`); a row without recorded references gets its one as
 *   `settings.referenceAssets` in the `reference` slot (`gained`).
 * - `chatRequests`: a Chat card request that recorded its whole prompt becomes the short request
 *   Chat records now: `Edit iteration <n>`, or `Edit this result` when its source is not in the chat.
 * Plans by default, printing the mapping; `apply` copies every file and row it changes to a
 * `.backups/legacy-records-*` folder with a `mapping.json` (restorable with `--restore`), then
 * writes them, with Studio stopped. A second run finds nothing.
 */
const modelChoices = { "z-image": "zimage", wan: "wan22_5b", checkpoint: "" };
const singleReferenceKeys = ["startImageId", "referenceImage", "referenceImageName"];
const chatRequest = /^(Edit|Animate|Extend|Recreate) (iteration \d+|this result)$/;

function planLoraStacks(dataDir) {
  const { canonical } = createProfileStore({ dataDir, log: { info() {}, warn() {} } });
  const familyOf = (key) => {
    const id = canonical(key.startsWith("custom:") ? key.slice(7) : key);
    const file = path.join(dataDir, "workflows", `${id}.json`);
    if (!fs.existsSync(file)) return "";
    return `family:${readJsonFile(file)?.studio?.family || "custom"}`;
  };
  const changes = [];
  const unresolved = [];
  for (const { name, value: state } of ownerDocuments(dataDir, "lora-stacks")) {
    const snapshots = state?.library?.snapshots;
    if (!isObject(snapshots)) continue;
    const moves = [];
    for (const [key, stacks] of Object.entries(snapshots)) {
      if (key.startsWith("family:")) continue;
      const to = familyOf(key);
      if (to) moves.push({ from: key, to, stacks: Array.isArray(stacks) ? stacks.length : 0 });
      else unresolved.push({ document: name, key });
    }
    if (moves.length) changes.push({ name, state, moves });
  }
  return { changes, unresolved };
}

function movedStacks(state, moves) {
  const snapshots = { ...state.library.snapshots };
  for (const { from, to } of moves) {
    const list = Array.isArray(snapshots[to]) ? [...snapshots[to]] : [];
    for (const stack of Array.isArray(snapshots[from]) ? snapshots[from] : [])
      if (!list.some((item) => item?.id === stack?.id)) list.push(stack);
    snapshots[to] = list;
    delete snapshots[from];
  }
  return { ...state, library: { ...state.library, snapshots } };
}

function planModelChoices(dataDir) {
  const choices = savedDocument(dataDir, "model-types");
  if (!isObject(choices)) return null;
  const counts = {};
  for (const value of Object.values(choices))
    if (Object.hasOwn(modelChoices, value)) {
      const mapping = `${value} → ${modelChoices[value] || "(removed)"}`;
      counts[mapping] = (counts[mapping] || 0) + 1;
    }
  return Object.keys(counts).length ? { choices, counts } : null;
}

function currentChoices(choices) {
  return Object.fromEntries(
    Object.entries(choices).flatMap(([key, value]) =>
      !Object.hasOwn(modelChoices, value)
        ? [[key, value]]
        : modelChoices[value]
          ? [[key, modelChoices[value]]]
          : [],
    ),
  );
}

const hasTable = (db, name) =>
  Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(name));

/** A gallery row without the single-reference keys, and whether its reference became a recorded one. */
function currentGalleryItem(item) {
  const legacyId = String(item.startImageId || item.referenceImage || "");
  const next = Object.fromEntries(
    Object.entries(item).filter(([key]) => !singleReferenceKeys.includes(key)),
  );
  const recorded = item.settings?.referenceAssets;
  const gained = Boolean(legacyId) && !(Array.isArray(recorded) && recorded.length);
  if (gained)
    next.settings = {
      ...item.settings,
      referenceAssets: [{ slot: "reference", assetId: legacyId }],
    };
  return { next, gained };
}

function planRows(dataDir) {
  return (
    withOfflineDatabase(dataDir, (db) => {
      const gallery = hasTable(db, "studio_gallery")
        ? db
            .prepare("SELECT key, value FROM studio_gallery")
            .all()
            .filter(({ value }) => {
              const item = JSON.parse(value);
              return singleReferenceKeys.some((key) => Object.hasOwn(item, key));
            })
        : [];
      const chat = [];
      if (hasTable(db, "studio_chat_messages") && hasTable(db, "studio_queue")) {
        const jobs = db.prepare(
          "SELECT id FROM studio_queue WHERE owner_id = ? AND session_id = ? ORDER BY created_at, rowid",
        );
        for (const row of db
          .prepare("SELECT id, owner_id, session_id, record FROM studio_chat_messages")
          .all()) {
          const message = JSON.parse(row.record);
          if (message.role !== "user" || !message.revision) continue;
          if (chatRequest.test(String(message.content || ""))) continue;
          const index = jobs
            .all(row.owner_id, row.session_id)
            .findIndex((job) => job.id === message.revision.sourceJobId);
          chat.push({
            id: row.id,
            record: row.record,
            content: index < 0 ? "Edit this result" : `Edit iteration ${index + 1}`,
          });
        }
      }
      return { gallery, chat };
    }) || { gallery: [], chat: [] }
  );
}

export function legacyRecords(dataDir, { apply = false } = {}) {
  const lora = planLoraStacks(dataDir);
  const models = planModelChoices(dataDir);
  const rows = planRows(dataDir);
  const gallery = rows.gallery.map(({ key, value }) => ({
    key,
    value,
    ...currentGalleryItem(JSON.parse(value)),
  }));
  const plan = {
    loraStacks: Object.fromEntries(lora.changes.map(({ name, moves }) => [name, moves])),
    unresolved: lora.unresolved,
    modelChoices: models?.counts || {},
    galleryReferences: {
      records: gallery.length,
      gained: gallery.filter(({ gained }) => gained).length,
    },
    chatRequests: rows.chat.length,
  };
  const pending = lora.changes.length || models || gallery.length || rows.chat.length;
  if (!apply || !pending) return { ...plan, applied: false, backup: "" };

  const copies = [
    ...lora.changes.map(({ name, state }) => ({
      source: ownerDocumentFile(name),
      bytes: Buffer.from(JSON.stringify(state)),
    })),
    ...(models
      ? [{ source: "model-types.json", bytes: Buffer.from(JSON.stringify(models.choices)) }]
      : []),
    ...(gallery.length
      ? [
          {
            source: "studio_gallery.json",
            bytes: Buffer.from(JSON.stringify(gallery.map(({ key, value }) => ({ key, value })))),
          },
        ]
      : []),
    ...(rows.chat.length
      ? [
          {
            source: "studio_chat_messages.json",
            bytes: Buffer.from(JSON.stringify(rows.chat.map(({ id, record }) => ({ id, record })))),
          },
        ]
      : []),
  ].map((copy) => ({ ...copy, hash: digest(copy.bytes) }));
  const backup = verifiedBackup(dataDir, "legacy-records", copies, {
    ...plan,
    mappings: copies.map(({ source, hash }) => ({ source, hash })),
  });

  const db = runtimeDatabase(dataDir);
  db.exec("BEGIN IMMEDIATE");
  try {
    const saveItem = db.prepare("UPDATE studio_gallery SET value = ? WHERE key = ? AND value = ?");
    for (const { key, value, next } of gallery)
      if (!saveItem.run(JSON.stringify(next), key, value).changes)
        throw new Error(`Gallery item ${key} changed during the migration`);
    const saveMessage = db.prepare(
      "UPDATE studio_chat_messages SET record = ? WHERE id = ? AND record = ?",
    );
    for (const { id, record, content } of rows.chat)
      if (!saveMessage.run(JSON.stringify({ ...JSON.parse(record), content }), id, record).changes)
        throw new Error(`Chat message ${id} changed during the migration`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  for (const { name, state, moves } of lora.changes)
    writeRuntimeDocument(dataDir, name, movedStacks(state, moves));
  if (models) writeRuntimeDocument(dataDir, "model-types", currentChoices(models.choices));
  return { ...plan, applied: true, backup };
}
