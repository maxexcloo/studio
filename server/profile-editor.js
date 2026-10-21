import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { metadataFromJson, userWorkflowsDir, validateGraph, workflowMissingFiles } from "./custom-workflows.js";
import { dataDir } from "./gallery-store.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { requireAdmin } from "./route-access.js";

/**
 * Settings › Profiles: an administrator edits Studio's own copy of one model
 * profile (a workflow JSON in the data folder) as text. Each save keeps the
 * previous file in backups and is listed in `.studio-edits.json` beside the
 * profiles, which says which copies differ from the profiles repository until
 * those edits are committed there.
 */
export const editsFile = () => path.join(userWorkflowsDir, ".studio-edits.json");
const backupsDir = () => path.join(dataDir, "backups", "profile-edits");
const validId = (id) => /^[a-z0-9][a-z0-9._-]{0,79}$/.test(String(id || "")) && !String(id).includes("..");
const hashOf = (text) => crypto.createHash("sha256").update(text).digest("hex");
const fileFor = (id) => path.join(userWorkflowsDir, `${id}.json`);
const metaOf = (raw) => raw?.heissUi || raw?.heiss_ui || raw?.jAiStudio || raw?.j_ai_studio || null;

function readEdits() {
  try { const saved = readJsonFile(editsFile()); return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {}; }
  catch { return {}; }
}

/** Every profile file Studio holds, by its file name, with whether Studio edited it. */
export function listEditableProfiles() {
  if (!fs.existsSync(userWorkflowsDir)) return [];
  const edits = readEdits();
  return fs.readdirSync(userWorkflowsDir).filter((name) => name.endsWith(".json") && !name.startsWith(".")).map((name) => {
    const id = name.slice(0, -5);
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(path.join(userWorkflowsDir, name), "utf8")); } catch { /* listed as unreadable */ }
    const meta = metaOf(raw) || {};
    return { id, profileId: `custom:${meta.id || id}`, name: String(meta.name || id), kind: meta.kind === "video" ? "video" : "image", family: String(meta.family || ""), readable: Boolean(raw), edited: edits[id] || null };
  }).filter((item) => validId(item.id)).sort((a, b) => a.name.localeCompare(b.name));
}

export function readEditableProfile(id) {
  if (!validId(id) || !fs.existsSync(fileFor(id))) throw Object.assign(new Error("That profile was not found."), { status: 404 });
  const text = fs.readFileSync(fileFor(id), "utf8");
  return { id, text, hash: hashOf(text), edited: readEdits()[id] || null };
}

const controlTargets = (meta) => Object.entries(meta?.controls || {}).filter(([, value]) => value && typeof value === "object" && "node" in value);

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
  try { raw = JSON.parse(String(text ?? "")); }
  catch (error) { return { ok: false, errors: [`Not valid JSON: ${error.message}`], warnings }; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["The profile must be a JSON object."], warnings };
  const meta = metaOf(raw);
  if (!meta || typeof meta !== "object") errors.push("Missing the heissUi block that describes the profile.");
  else {
    if (!String(meta.name || "").trim()) errors.push("heissUi.name is required.");
    if (meta.id && meta.id !== id) errors.push(`heissUi.id must stay "${id}"; save a copy under a new file to rename it.`);
    if (meta.kind && !["image", "video"].includes(meta.kind)) errors.push("heissUi.kind must be image or video.");
    if ("nsfw" in meta && typeof meta.nsfw !== "boolean") errors.push("heissUi.nsfw must be true or false.");
    if (!meta.controls || typeof meta.controls !== "object") errors.push("heissUi.controls is required.");
    else if (!meta.controls.prompt) errors.push("heissUi.controls.prompt is required.");
  }
  let workflow = null;
  try {
    workflow = metadataFromJson(raw, fileFor(id));
    validateGraph(workflow.graph);
  } catch (error) { errors.push(error.message); }
  if (workflow && meta) {
    for (const [key, target] of controlTargets(meta)) {
      const node = workflow.graph?.[String(target.node)];
      if (!node) errors.push(`controls.${key} points at node ${target.node}, which isn’t in the graph.`);
      else if (target.input && !(String(target.input) in (node.inputs || {}))) errors.push(`controls.${key} points at input "${target.input}", which node ${target.node} (${node.class_type}) doesn’t have.`);
    }
    if (info && Object.keys(info).length) {
      const unknown = [...new Set(Object.values(workflow.graph || {}).map((node) => node?.class_type).filter((type) => type && !info[type]))];
      if (unknown.length) warnings.push(`ComfyUI doesn’t know these node types: ${unknown.join(", ")}.`);
      for (const missing of workflowMissingFiles(workflow, info)) warnings.push(`ComfyUI doesn’t list the ${missing.kind} ${missing.file} (models/${missing.folder}).`);
    } else warnings.push("ComfyUI couldn’t be asked, so node types and model files weren’t checked.");
  }
  return { ok: !errors.length, errors, warnings, raw: errors.length ? undefined : raw };
}

/** Saves a checked edit: the old file goes to backups, the edit is recorded, and a stale base is refused. */
export function saveEditableProfile(id, text, { baseHash = "", by = "", info = null } = {}) {
  const current = readEditableProfile(id);
  if (baseHash && baseHash !== current.hash) throw Object.assign(new Error("This profile changed since you opened it. Reload it, then make your edit again."), { status: 409 });
  const checked = validateProfileText(id, text, { info });
  if (!checked.ok) throw Object.assign(new Error(checked.errors[0]), { status: 400, checked });
  const at = new Date();
  fs.mkdirSync(backupsDir(), { recursive: true });
  fs.writeFileSync(path.join(backupsDir(), `${id}-${at.toISOString().replace(/[:.]/g, "-")}.json`), current.text, { mode: 0o600 });
  // Saved as written, so the diff the editor showed is the change on disk.
  const next = String(text).endsWith("\n") ? String(text) : `${text}\n`;
  const temporary = `${fileFor(id)}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, next);
  fs.renameSync(temporary, fileFor(id));
  const edits = readEdits();
  edits[id] = { editedAt: at.toISOString(), by: String(by || ""), baseHash: edits[id]?.baseHash || current.hash };
  writeJsonFile(editsFile(), edits);
  return { ...readEditableProfile(id), warnings: checked.warnings };
}

export function registerProfileEditorRoutes(app, { objectInfo = async () => null, onSaved = () => {}, accountName = () => "" } = {}) {
  const info = async (kind) => { try { return await objectInfo(kind); } catch { return null; } };
  const fail = (res, error) => res.status(error.status || 400).json({ ok: false, error: error.message, ...(error.checked ? { errors: error.checked.errors, warnings: error.checked.warnings } : {}) });
  app.get("/api/profiles/editable", (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, profiles: listEditableProfiles() });
  });
  app.get("/api/profiles/editable/:id", (req, res) => {
    if (!requireAdmin(req, res)) return;
    try { res.setHeader("Cache-Control", "no-store"); res.json({ ok: true, ...readEditableProfile(req.params.id) }); }
    catch (error) { fail(res, error); }
  });
  app.post("/api/profiles/editable/:id/check", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const current = readEditableProfile(req.params.id);
      const kind = metaOf((() => { try { return JSON.parse(current.text); } catch { return null; } })())?.kind;
      const { raw: _raw, ...checked } = validateProfileText(req.params.id, req.body?.text, { info: await info(kind) });
      res.json({ ok: true, check: checked });
    } catch (error) { fail(res, error); }
  });
  app.put("/api/profiles/editable/:id", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      let kind = "image";
      try { kind = metaOf(JSON.parse(String(req.body?.text || "")))?.kind || "image"; } catch { /* the check reports it */ }
      const saved = saveEditableProfile(req.params.id, req.body?.text, { baseHash: String(req.body?.baseHash || ""), by: accountName(req), info: await info(kind) });
      await onSaved(req.params.id);
      res.json({ ok: true, ...saved });
    } catch (error) { fail(res, error); }
  });
}
