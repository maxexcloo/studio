#!/usr/bin/env node
// Imports a single-user HEISS studio into one account of a multi-user studio
// (server/studio-import.js). A dry run unless --apply; the source is never changed.
//
//   node scripts/import-studio.mjs --source-data <dir> --source-outputs <comfy output dir> --account <username> [--label X] [--apply]
//   node scripts/import-studio.mjs --undo <batch>
//
// The target is this studio: HEISS_DATA_DIR (and HEISS_MEDIA_DIR). Stop HEISS first.
import path from "node:path";
import { applyStudioImport, findAccount, planStudioImport, summarizePlan, undoStudioImport } from "../server/studio-import.js";

const args = process.argv.slice(2);
const option = (name) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; };
const flag = (name) => args.includes(`--${name}`);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const targetData = path.resolve(option("target-data") || process.env.HEISS_DATA_DIR || path.join(root, "data"));
const mediaRoot = path.resolve(option("media-dir") || process.env.HEISS_MEDIA_DIR || path.join(targetData, "media"));
const port = Number(option("port") || process.env.PORT || 8787);

async function serverRunning() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch { return false; }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (flag("help") || !args.length) {
  console.log("Usage: node scripts/import-studio.mjs --source-data <dir> --source-outputs <dir> --account <username> [--label <name>] [--apply]\n       node scripts/import-studio.mjs --undo <batch>\nTarget: HEISS_DATA_DIR / HEISS_MEDIA_DIR (or --target-data, --media-dir). Stop HEISS before --apply or --undo.");
  process.exit(0);
}
const writes = flag("apply") || option("undo");
if (writes && await serverRunning() && !flag("ignore-running")) fail(`HEISS answers on port ${port}. Stop it before importing, so it cannot overwrite the gallery.`);

if (option("undo")) {
  console.log(JSON.stringify(undoStudioImport(targetData, option("undo")), null, 2));
  process.exit(0);
}

const sourceData = option("source-data");
const sourceOutputs = option("source-outputs");
const username = option("account");
if (!sourceData || !sourceOutputs || !username) fail("Name --source-data, --source-outputs and --account.");
const account = findAccount(targetData, username);
if (!account) fail(`No account named ${username} exists in ${targetData}. Create it first.`);
const plan = planStudioImport({
  sourceData: path.resolve(sourceData), sourceOutputs: path.resolve(sourceOutputs), targetData, mediaRoot,
  account, label: option("label") || path.basename(path.resolve(sourceData)),
  galleryLimit: Number(process.env.HEISS_GALLERY_LIMIT || 50_000)
});
const summary = summarizePlan(plan);
console.log(JSON.stringify({ mode: flag("apply") ? "apply" : "dry run", from: { data: plan.sourceData, outputs: plan.sourceOutputs }, to: { data: targetData, media: path.join(mediaRoot, plan.subfolder) }, ...summary }, null, 2));
if (!flag("apply")) {
  console.log(summary.conflicts.length ? "\nResolve the conflicts above, then run again with --apply." : "\nNothing was changed. Run again with --apply to import.");
  process.exit(summary.conflicts.length ? 1 : 0);
}
try {
  const result = applyStudioImport(plan);
  console.log(`\nImported. Undo with: node scripts/import-studio.mjs --undo ${result.batch}\nManifest and backups: ${path.dirname(result.manifest)}`);
} catch (error) { fail(error.message); }
