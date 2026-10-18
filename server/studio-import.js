import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isInside } from "./paths.js";

/**
 * Moves a whole single-user studio (its data folder and ComfyUI output folder)
 * into one account of a multi-user studio with HEISS media storage. Nothing in
 * the source is changed: files are copied, records are rewritten for the
 * account, and every target file that changes is backed up first. A manifest
 * lists exactly what was added, so `undoStudioImport` can take it out again.
 *
 * Kept free of the server's environment-reading modules: every folder is an
 * explicit argument, so the same code plans against any pair of studios.
 */

const mediaPattern = /\.(png|jpe?g|webp|gif|avif|bmp|tiff?|mp4|webm|mov|mkv|m4v|flac|mp3|wav|ogg|opus|m4a|aac)$/i;
const ownerHash = (accountId) => crypto.createHash("sha256").update(String(accountId)).digest("hex");
export const accountMediaSubfolder = (accountId) => `heiss-ui/accounts/${ownerHash(accountId)}`;
const accountDataDir = (dataDir, accountId) => path.join(dataDir, "accounts", ownerHash(accountId));
// Per-account files that move as they are; the target must not have them yet.
const perAccountFiles = ["prompt-history.json", "negative-prompt-history.json", "lora-stacks.json"];

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw new Error(`${file} could not be read: ${error.message}`);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.import.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function viewRef(url) {
  const value = String(url || "");
  if (!value.startsWith("/comfy/view?")) return null;
  const params = new URLSearchParams(value.slice(value.indexOf("?") + 1));
  if ((params.get("type") || "output") !== "output") return null;
  const filename = params.get("filename") || "";
  return filename ? { filename, subfolder: params.get("subfolder") || "" } : null;
}

function sourceFile(outputsDir, ref) {
  if (!outputsDir || !ref || ref.filename !== path.basename(ref.filename) || !mediaPattern.test(ref.filename)) return null;
  if (String(ref.subfolder).split(/[\\/]/).some((part) => part.startsWith("."))) return null;
  const file = path.resolve(outputsDir, ref.subfolder, ref.filename);
  if (!isInside(path.resolve(outputsDir), file)) return null;
  try { return fs.statSync(file).isFile() ? file : null; } catch { return null; }
}

function mediaUrls(filename, subfolder) {
  const query = new URLSearchParams({ filename, subfolder, type: "media" }).toString();
  return { url: `/comfy/view?${query}`, thumbnailUrl: `/comfy/thumb?${query}` };
}

/** The account a username names in the target studio's account store. */
export function findAccount(targetData, username) {
  const store = readJson(path.join(targetData, "accounts.json"), { accounts: [] });
  const key = String(username || "").trim().normalize("NFKC").toLocaleLowerCase("en-AU");
  return (store.accounts || []).find((account) => String(account.username || "").trim().normalize("NFKC").toLocaleLowerCase("en-AU") === key) || null;
}

/** What an import would do, without touching anything. */
export function planStudioImport({ sourceData, sourceOutputs, targetData, mediaRoot, account, label = "studio", galleryLimit = 50_000 }) {
  if (!account?.id) throw new Error("Choose an existing account in the target studio.");
  if (path.resolve(sourceData) === path.resolve(targetData)) throw new Error("The source and target data folders must differ.");
  const batch = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}`;
  const subfolder = accountMediaSubfolder(account.id);
  const plan = { batch, label, account: { id: account.id, username: account.username }, sourceData, sourceOutputs, targetData, mediaRoot, subfolder, copies: [], records: [], references: [], files: [], mcp: { jobs: {}, assets: {} }, skipped: {}, conflicts: [], bytes: 0 };
  const skip = (reason) => { plan.skipped[reason] = (plan.skipped[reason] || 0) + 1; };

  const targetGallery = readJson(path.join(targetData, "gallery.json"), []);
  const targetJobs = new Set(targetGallery.map((item) => item.jobId).filter(Boolean));
  const usedNames = new Set();
  const copyMedia = (ref) => {
    const from = sourceFile(sourceOutputs, ref);
    if (!from) return null;
    let filename = `imported-${batch.slice(-6)}-${ref.filename}`;
    for (let n = 2; usedNames.has(filename); n += 1) filename = `imported-${batch.slice(-6)}-${n}-${ref.filename}`;
    usedNames.add(filename);
    const to = path.resolve(mediaRoot, subfolder, filename);
    plan.copies.push({ from, to });
    plan.bytes += fs.statSync(from).size;
    return mediaUrls(filename, subfolder);
  };

  for (const item of readJson(path.join(sourceData, "gallery.json"), [])) {
    if (item.privateVault || item.hidden) { skip("Hidden items (encrypted, not migrated)"); continue; }
    if (item.status !== "done") { skip(`${item.status || "unknown"} records`); continue; }
    if (item.library) { skip("library folder items (shown in place, not studio files)"); continue; }
    if (item.ownerId) { skip("records already owned by an account"); continue; }
    if (item.jobId && targetJobs.has(item.jobId)) { plan.conflicts.push(`Job ${item.jobId} is already in the target gallery.`); continue; }
    const urls = copyMedia(viewRef(item.url));
    if (!urls) { skip(String(item.url || "").startsWith("/comfy/view?") ? "outputs whose file is missing" : "records without a ComfyUI output file"); continue; }
    const record = { ...item, ...urls, id: urls.url, ownerId: account.id, outputName: new URLSearchParams(urls.url.split("?")[1]).get("filename"), importedFrom: { label, batch } };
    if (item.upscale?.url) {
      const upscale = copyMedia(viewRef(item.upscale.url));
      if (upscale) record.upscale = { ...item.upscale, ...upscale, outputName: new URLSearchParams(upscale.url.split("?")[1]).get("filename") };
      else { record.upscale = undefined; record.upscaleActive = false; skip("upscales whose file is missing"); }
    }
    plan.records.push(record);
  }
  if (targetGallery.length + plan.records.length > galleryLimit) plan.conflicts.push(`The target gallery would hold ${targetGallery.length + plan.records.length} records, above HEISS_GALLERY_LIMIT (${galleryLimit}).`);

  const targetAccountDir = accountDataDir(targetData, account.id);
  for (const name of perAccountFiles) {
    const from = path.join(sourceData, name);
    if (!fs.existsSync(from)) continue;
    const to = path.join(targetAccountDir, name);
    if (fs.existsSync(to)) plan.conflicts.push(`${account.username} already has ${name}; remove it or merge by hand first.`);
    else plan.files.push({ from, to });
  }

  const assetsFrom = path.join(sourceData, "reference-assets");
  const assetIds = {};
  for (const record of readJson(path.join(assetsFrom, "index.json"), [])) {
    if (record.source !== "upload" || record.ownerId) { skip("reference records that are not studio uploads"); continue; }
    const file = path.join(assetsFrom, "files", path.basename(String(record.file || "")));
    if (!fs.existsSync(file)) { skip("reference uploads whose file is missing"); continue; }
    const id = crypto.randomUUID();
    const thumbnail = path.join(assetsFrom, "thumbnails", path.basename(String(record.thumbnail || "")));
    const ext = path.extname(record.file) || ".png";
    const thumbExt = path.extname(record.thumbnail || "") || ".webp";
    assetIds[record.id] = id;
    plan.references.push({
      record: { ...record, id, file: `${id}${ext}`, thumbnail: `${id}${thumbExt}`, ownerId: account.id, importedFrom: { label, batch } },
      copies: [{ from: file, to: path.join(targetData, "reference-assets", "files", `${id}${ext}`) }, ...(fs.existsSync(thumbnail) ? [{ from: thumbnail, to: path.join(targetData, "reference-assets", "thumbnails", `${id}${thumbExt}`) }] : [])]
    });
  }

  // MCP: the old studio's jobs and uploads (owned by gateway users there) all belong to this account now.
  const mcp = readJson(path.join(sourceData, "mcp-ownership.json"), null);
  const importedJobs = new Set(plan.records.map((item) => item.jobId).filter(Boolean));
  for (const jobId of Object.keys(mcp?.jobs || {})) if (importedJobs.has(jobId)) plan.mcp.jobs[jobId] = account.id;
  for (const assetId of Object.keys(mcp?.assets || {})) if (assetIds[assetId]) plan.mcp.assets[assetIds[assetId]] = account.id;

  for (const [name, reason] of [["presets.json", "presets (administrator-only in multi-user mode)"], ["vault", "Hidden vault (encrypted, not migrated)"], ["workflow-preferences.json", "workflow preferences (studio-wide; set them again if wanted)"]]) {
    if (fs.existsSync(path.join(sourceData, name))) skip(reason);
  }
  return plan;
}

export function summarizePlan(plan) {
  return {
    batch: plan.batch,
    account: plan.account.username,
    galleryRecords: plan.records.length,
    mediaFiles: plan.copies.length,
    mediaBytes: plan.bytes,
    referenceUploads: plan.references.length,
    accountFiles: plan.files.map((file) => path.basename(file.to)),
    mcpJobs: Object.keys(plan.mcp.jobs).length,
    mcpAssets: Object.keys(plan.mcp.assets).length,
    skipped: plan.skipped,
    conflicts: plan.conflicts
  };
}

/** Carries a plan out. Refuses any plan with conflicts; backs up every target file it changes. */
export function applyStudioImport(plan) {
  if (plan.conflicts.length) throw new Error(`Resolve these first:\n- ${plan.conflicts.join("\n- ")}`);
  const batchDir = path.join(plan.targetData, "imports", plan.batch);
  const backups = path.join(batchDir, "backup");
  fs.mkdirSync(backups, { recursive: true, mode: 0o700 });
  const targets = { gallery: path.join(plan.targetData, "gallery.json"), references: path.join(plan.targetData, "reference-assets", "index.json"), mcp: path.join(plan.targetData, "mcp-ownership.json") };
  for (const [name, file] of Object.entries(targets)) if (fs.existsSync(file)) fs.copyFileSync(file, path.join(backups, `${name}.json`));

  const created = [];
  const manifest = { batch: plan.batch, label: plan.label, accountId: plan.account.id, created, recordIds: plan.records.map((item) => item.id), referenceIds: plan.references.map((item) => item.record.id), mcp: plan.mcp, backups: Object.keys(targets).filter((name) => fs.existsSync(path.join(backups, `${name}.json`))) };
  const copy = ({ from, to }) => {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    created.push(to);
  };
  try {
    for (const item of plan.copies) copy(item);
    for (const item of plan.files) copy(item);
    for (const reference of plan.references) for (const item of reference.copies) copy(item);

    writeJson(targets.gallery, [...plan.records, ...readJson(targets.gallery, [])]);
    if (plan.references.length) writeJson(targets.references, [...plan.references.map((item) => item.record), ...readJson(targets.references, [])]);
    if (Object.keys(plan.mcp.jobs).length || Object.keys(plan.mcp.assets).length) {
      const state = readJson(targets.mcp, null) || { version: 1, signingKey: crypto.randomBytes(32).toString("base64url"), jobs: {}, assets: {} };
      writeJson(targets.mcp, { ...state, jobs: { ...state.jobs, ...plan.mcp.jobs }, assets: { ...state.assets, ...plan.mcp.assets } });
    }
  } finally {
    writeJson(path.join(batchDir, "manifest.json"), manifest);
  }
  return { manifest: path.join(batchDir, "manifest.json"), ...summarizePlan(plan) };
}

/** Takes one import back out: its records, references, MCP entries and copied files. The source was never changed. */
export function undoStudioImport(targetData, batch) {
  const batchDir = path.join(targetData, "imports", path.basename(String(batch || "")));
  const manifest = readJson(path.join(batchDir, "manifest.json"), null);
  if (!manifest) throw new Error(`No import named ${batch} was found.`);
  const recordIds = new Set(manifest.recordIds);
  const referenceIds = new Set(manifest.referenceIds);
  const gallery = path.join(targetData, "gallery.json");
  writeJson(gallery, readJson(gallery, []).filter((item) => !recordIds.has(item.id)));
  const references = path.join(targetData, "reference-assets", "index.json");
  if (fs.existsSync(references)) writeJson(references, readJson(references, []).filter((item) => !referenceIds.has(item.id)));
  const mcpFile = path.join(targetData, "mcp-ownership.json");
  const mcp = readJson(mcpFile, null);
  if (mcp) {
    for (const id of Object.keys(manifest.mcp?.jobs || {})) delete mcp.jobs[id];
    for (const id of Object.keys(manifest.mcp?.assets || {})) delete mcp.assets[id];
    writeJson(mcpFile, mcp);
  }
  let removed = 0;
  for (const file of manifest.created || []) { try { fs.unlinkSync(file); removed += 1; } catch { /* already gone */ } }
  fs.renameSync(batchDir, `${batchDir}.undone`);
  return { batch: manifest.batch, records: recordIds.size, references: referenceIds.size, filesRemoved: removed };
}
