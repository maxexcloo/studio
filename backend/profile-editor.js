import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  metadataFromJson,
  userWorkflowsDir,
  validateGraph,
  workflowMissingFiles,
} from "./custom-workflows.js";
import { dataDir } from "./gallery-store.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { fromChat, requireAdmin } from "./route-access.js";
import { profileStore } from "./profile-store.js";
import { profileBlock, profileBlockName, profileBlocksIn } from "./profile-block.js";

/**
 * Studio owns editable runtime profiles and their version history; ai is a read-only seed.
 */
export const editsFile = () => path.join(userWorkflowsDir, ".studio-edits.json");
const backupsDir = () => path.join(dataDir, "backups", "profile-edits");
const validId = (id) =>
  /^[a-z0-9][a-z0-9._-]{0,79}$/.test(String(id || "")) && !String(id).includes("..");
const hashOf = (text) => crypto.createHash("sha256").update(text).digest("hex");
const fileFor = (id) => path.join(userWorkflowsDir, `${id}.json`);
const metaOf = (raw) => profileBlock(raw);

function readEdits() {
  try {
    const saved = readJsonFile(editsFile());
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

/** Every profile file Studio holds, by its file name, with whether Studio edited it. */
export function listEditableProfiles() {
  if (!fs.existsSync(userWorkflowsDir)) return [];
  const edits = readEdits();
  const versions = profileStore({ workflowsDir: userWorkflowsDir }).metas();
  return fs
    .readdirSync(userWorkflowsDir)
    .filter((name) => name.endsWith(".json") && !name.startsWith("."))
    .map((name) => {
      const id = name.slice(0, -5);
      let raw = null;
      try {
        raw = JSON.parse(fs.readFileSync(path.join(userWorkflowsDir, name), "utf8"));
      } catch {
        /* listed as unreadable */
      }
      const meta = metaOf(raw) || {};
      const version = versions[id] || null;
      return {
        id,
        profileId: `custom:${meta.id || id}`,
        name: String(meta.name || id),
        kind: meta.kind === "video" ? "video" : "image",
        family: String(meta.family || ""),
        readable: Boolean(raw),
        edited: edits[id] || null,
        version: version?.version || 0,
        origin: version?.origin || "seed",
        aiDrafted: version?.aiDrafted === true,
        nsfw: meta.nsfw === true,
      };
    })
    .filter((item) => validId(item.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function readEditableProfile(id) {
  if (!validId(id) || !fs.existsSync(fileFor(id)))
    throw Object.assign(new Error("That profile was not found."), { status: 404 });
  const text = fs.readFileSync(fileFor(id), "utf8");
  let blockName = null;
  try {
    blockName = profileBlockName(JSON.parse(text));
  } catch {
    // The raw editor can repair a malformed workflow.
  }
  return {
    id,
    text,
    blockName,
    hash: hashOf(text),
    edited: readEdits()[id] || null,
    version: profileStore({ workflowsDir: userWorkflowsDir }).meta(id),
  };
}

/** Whether a profile id is in use now or was ever held by Studio (so a new draft never reuses it). */
export function profileIdTaken(id) {
  return (
    !validId(id) ||
    fs.existsSync(fileFor(id)) ||
    profileStore({ workflowsDir: userWorkflowsDir }).known(id)
  );
}

/**
 * Adds a new profile file (an AI draft from a checkpoint import), checked like any edit. It is
 * listed in `.studio-edits.json` too, so no seed deploy would ever write over it, and becomes the
 * profile's next version with its origin and AI-Drafted marker.
 */
export function createEditableProfile(
  id,
  text,
  { by = "", info = null, origin = "ai", aiDrafted = true, note = "" } = {},
) {
  if (!validId(id))
    throw Object.assign(
      new Error("Choose a profile id: lowercase letters, digits, dots, dashes or underscores."),
      { status: 400 },
    );
  if (fs.existsSync(fileFor(id)))
    throw Object.assign(new Error("A profile with that id already exists."), { status: 409 });
  const checked = validateProfileText(id, text, { info });
  if (!checked.ok) throw Object.assign(new Error(checked.errors[0]), { status: 400, checked });
  const next = String(text).endsWith("\n") ? String(text) : `${text}\n`;
  fs.mkdirSync(userWorkflowsDir, { recursive: true });
  const temporary = `${fileFor(id)}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, next, { flag: "wx" });
  fs.renameSync(temporary, fileFor(id));
  const at = new Date().toISOString();
  const edits = readEdits();
  edits[id] = { editedAt: at, by: String(by || ""), baseHash: "" };
  writeJsonFile(editsFile(), edits);
  profileStore({ workflowsDir: userWorkflowsDir }).record(id, next, {
    by,
    origin,
    aiDrafted,
    at,
    note,
  });
  return { ...readEditableProfile(id), warnings: checked.warnings };
}

/** Clears AI-Drafted on a profile: an administrator reviewed it, so it follows access profiles. */
export function approveEditableProfile(id, { by = "" } = {}) {
  readEditableProfile(id);
  return profileStore({ workflowsDir: userWorkflowsDir }).approve(id, { by });
}

const controlTargets = (meta) =>
  Object.entries(meta?.controls || {}).filter(
    ([, value]) => value && typeof value === "object" && "node" in value,
  );

/**
 * Checks edited text before it is saved. Errors stop the save: it must parse,
 * keep its id, name the profile, carry a valid graph and point every control at
 * a node and input that exist. Warnings don't: node types and model files
 * ComfyUI doesn't know, or ComfyUI being unreachable to ask.
 */
export function validateProfileText(id, text, { info = null } = {}) {
  const errors = [];
  const warnings = [];
  let raw;
  try {
    raw = JSON.parse(String(text ?? ""));
  } catch (error) {
    return { ok: false, errors: [`Not valid JSON: ${error.message}`], warnings };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { ok: false, errors: ["The profile must be a JSON object."], warnings };
  const meta = metaOf(raw);
  // Studio reads the new "studio" name and "heissUi"; both at once leaves it unclear which applies.
  const block = profileBlockName(raw) || "heissUi";
  const blocks = profileBlocksIn(raw);
  if (blocks.length > 1)
    errors.push(`Keep one profile block: this file has ${blocks.join(" and ")}.`);
  if (!meta || typeof meta !== "object")
    errors.push("Missing the heissUi (or studio) block that describes the profile.");
  else {
    if (!String(meta.name || "").trim()) errors.push(`${block}.name is required.`);
    if (meta.id && meta.id !== id)
      errors.push(`${block}.id must stay "${id}"; save a copy under a new file to rename it.`);
    if (meta.kind && !["image", "video"].includes(meta.kind))
      errors.push(`${block}.kind must be image or video.`);
    if ("nsfw" in meta && typeof meta.nsfw !== "boolean")
      errors.push(`${block}.nsfw must be true or false.`);
    if (!meta.controls || typeof meta.controls !== "object")
      errors.push(`${block}.controls is required.`);
    else if (!meta.controls.prompt) errors.push(`${block}.controls.prompt is required.`);
  }
  let workflow = null;
  try {
    workflow = metadataFromJson(raw, fileFor(id));
    validateGraph(workflow.graph);
  } catch (error) {
    errors.push(error.message);
  }
  if (workflow && meta) {
    for (const [key, target] of controlTargets(meta)) {
      const node = workflow.graph?.[String(target.node)];
      if (!node)
        errors.push(`controls.${key} points at node ${target.node}, which isn’t in the graph.`);
      else if (target.input && !(String(target.input) in (node.inputs || {})))
        errors.push(
          `controls.${key} points at input "${target.input}", which node ${target.node} (${node.class_type}) doesn’t have.`,
        );
    }
    if (info && Object.keys(info).length) {
      const unknown = [
        ...new Set(
          Object.values(workflow.graph || {})
            .map((node) => node?.class_type)
            .filter((type) => type && !info[type]),
        ),
      ];
      if (unknown.length)
        warnings.push(`ComfyUI doesn’t know these node types: ${unknown.join(", ")}.`);
      for (const missing of workflowMissingFiles(workflow, info))
        warnings.push(
          `ComfyUI doesn’t list the ${missing.kind} ${missing.file} (models/${missing.folder}).`,
        );
    } else
      warnings.push("ComfyUI couldn’t be asked, so node types and model files weren’t checked.");
  }
  return { ok: !errors.length, errors, warnings, raw: errors.length ? undefined : raw };
}

/**
 * Saves a checked edit: the old file goes to backups, the edit is recorded, and a stale base is refused.
 * Every save is also a version (profile-store.js); an AI draft (`origin` "ai", `aiDrafted`) is marked
 * so, and any other save clears the marker.
 */
export function saveEditableProfile(
  id,
  text,
  { baseHash = "", by = "", info = null, origin = "studio", aiDrafted = false } = {},
) {
  const current = readEditableProfile(id);
  if (baseHash && baseHash !== current.hash)
    throw Object.assign(
      new Error("This profile changed since you opened it. Reload it, then make your edit again."),
      { status: 409 },
    );
  const checked = validateProfileText(id, text, { info });
  if (!checked.ok) throw Object.assign(new Error(checked.errors[0]), { status: 400, checked });
  const at = new Date();
  fs.mkdirSync(backupsDir(), { recursive: true });
  fs.writeFileSync(
    path.join(backupsDir(), `${id}-${at.toISOString().replace(/[:.]/g, "-")}.json`),
    current.text,
    { mode: 0o600 },
  );
  // Saved as written, so the diff the editor showed is the change on disk.
  const next = String(text).endsWith("\n") ? String(text) : `${text}\n`;
  const temporary = `${fileFor(id)}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, next);
  fs.renameSync(temporary, fileFor(id));
  const edits = readEdits();
  edits[id] = {
    editedAt: at.toISOString(),
    by: String(by || ""),
    baseHash: edits[id]?.baseHash || current.hash,
  };
  writeJsonFile(editsFile(), edits);
  const store = profileStore({ workflowsDir: userWorkflowsDir });
  // Profiles saved before versioning start their history with the text they replace.
  if (!store.meta(id))
    store.record(id, current.text, {
      origin: edits[id].baseHash === current.hash ? "seed" : "studio",
      by: "seed",
    });
  store.record(id, next, { by, origin, aiDrafted });
  return { ...readEditableProfile(id), warnings: checked.warnings, version: store.meta(id) };
}

/** Restores an earlier version as a new version, checked like any edit. */
export function revertEditableProfile(
  id,
  version,
  { by = "", baseHash = "", info = null, origin = "studio" } = {},
) {
  const old = profileStore({ workflowsDir: userWorkflowsDir }).version(id, version);
  return saveEditableProfile(id, old.text, { baseHash, by, info, origin });
}

export function registerProfileEditorRoutes(
  app,
  { objectInfo = async () => null, onSaved = () => {}, accountName = () => "" } = {},
) {
  const info = async (kind) => {
    try {
      return await objectInfo(kind);
    } catch {
      return null;
    }
  };
  const fail = (res, error) =>
    res.status(error.status || 400).json({
      ok: false,
      error: error.message,
      ...(error.checked ? { errors: error.checked.errors, warnings: error.checked.warnings } : {}),
    });
  app.get("/api/profiles/editable", (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, profiles: listEditableProfiles() });
  });
  app.get("/api/profiles/editable/:id", (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true, ...readEditableProfile(req.params.id) });
    } catch (error) {
      fail(res, error);
    }
  });
  app.post("/api/profiles/editable/:id/check", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const current = readEditableProfile(req.params.id);
      const kind = metaOf(
        (() => {
          try {
            return JSON.parse(current.text);
          } catch {
            return null;
          }
        })(),
      )?.kind;
      const { raw: _raw, ...checked } = validateProfileText(req.params.id, req.body?.text, {
        info: await info(kind),
      });
      res.json({ ok: true, check: checked });
    } catch (error) {
      fail(res, error);
    }
  });
  app.put("/api/profiles/editable/:id", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      let kind = "image";
      try {
        kind = metaOf(JSON.parse(String(req.body?.text || "")))?.kind || "image";
      } catch {
        /* the check reports it */
      }
      // From chat (MCP's admin tools) the version's origin is chat; a draft stays AI-Drafted until approved.
      const chat = fromChat(req);
      const saved = saveEditableProfile(req.params.id, req.body?.text, {
        baseHash: String(req.body?.baseHash || ""),
        by: accountName(req),
        info: await info(kind),
        origin: chat ? "chat" : "studio",
        aiDrafted: chat && req.body?.draft === true,
      });
      await onSaved(req.params.id);
      res.json({ ok: true, ...saved });
    } catch (error) {
      fail(res, error);
    }
  });
}
