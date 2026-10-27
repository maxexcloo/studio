#!/usr/bin/env node
// Imports a single-user studio into one account of a multi-user studio
// (backend/studio-import.js). A dry run unless --apply; the source is never changed.
//
//   node backend/commands/import-studio.mjs --source-data <dir> --source-outputs <comfy output dir> --account <username> [--label X] [--apply]
//   node backend/commands/import-studio.mjs --undo <batch>
//
// The target is this studio: STUDIO_DATA_DIR (and STUDIO_MEDIA_DIR). Stop both studios first.
import path from "node:path";
import { fileURLToPath } from "node:url";
// The studio's own settings first: STUDIO_DATA_DIR, STUDIO_MEDIA_DIR and PORT may live in its .env (STUDIO_ENV_FILE).
await import("../env.js");
const { applyStudioImport, findAccount, planStudioImport, summarizePlan, undoStudioImport } =
  await import("../studio-import.js");

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const flag = (name) => args.includes(`--${name}`);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const targetData = path.resolve(
  option("target-data") || process.env.STUDIO_DATA_DIR || path.join(root, "data"),
);
const mediaRoot = path.resolve(
  option("media-dir") || process.env.STUDIO_MEDIA_DIR || path.join(targetData, "media"),
);
const port = Number(option("port") || process.env.PORT || 8787);

// Studio binds its configured port exactly, and may listen beyond loopback.
async function serverRunning() {
  const hosts = [
    ...new Set(
      [
        "127.0.0.1",
        process.env.HOST && !["0.0.0.0", "::"].includes(process.env.HOST) ? process.env.HOST : "",
      ].filter(Boolean),
    ),
  ];
  for (const host of hosts) {
    try {
      const response = await fetch(
        `http://${host.includes(":") ? `[${host}]` : host}:${port}/api/ping`,
        { signal: AbortSignal.timeout(800) },
      );
      if (response.ok && (await response.json().catch(() => ({}))).app === "studio") return port;
    } catch {
      /* nothing there */
    }
  }
  return 0;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (flag("help") || !args.length) {
  console.log(
    "Usage: node backend/commands/import-studio.mjs --source-data <dir> --source-outputs <dir> --account <username> [--source-media <dir>] [--label <name>] [--apply]\n       node backend/commands/import-studio.mjs --undo <batch>\nTarget: STUDIO_DATA_DIR / STUDIO_MEDIA_DIR (or --target-data, --media-dir). Stop both studios before planning or applying an import; stop the target before --undo.",
  );
  process.exit(0);
}
const writes = flag("apply") || option("undo");
const running = writes && !flag("ignore-running") ? await serverRunning() : 0;
if (running)
  fail(
    `Studio answers on port ${running}. Stop it before importing, so it cannot overwrite the gallery.`,
  );

if (option("undo")) {
  console.log(JSON.stringify(undoStudioImport(targetData, option("undo")), null, 2));
  process.exit(0);
}

const sourceData = option("source-data");
const sourceOutputs = option("source-outputs");
const username = option("account");
if (!sourceData || !sourceOutputs || !username)
  fail("Name --source-data, --source-outputs and --account.");
const account = findAccount(targetData, username);
if (!account) fail(`No account named ${username} exists in ${targetData}. Create it first.`);
const plan = planStudioImport({
  sourceData: path.resolve(sourceData),
  sourceOutputs: path.resolve(sourceOutputs),
  ...(option("source-media") ? { sourceMedia: path.resolve(option("source-media")) } : {}),
  targetData,
  mediaRoot,
  account,
  label: option("label") || path.basename(path.resolve(sourceData)),
  galleryLimit: Number(process.env.STUDIO_GALLERY_LIMIT || 50_000),
});
const summary = summarizePlan(plan);
console.log(
  JSON.stringify(
    {
      mode: flag("apply") ? "apply" : "dry run",
      from: { data: plan.sourceData, media: plan.sourceMedia, outputs: plan.sourceOutputs },
      to: { data: targetData, media: path.join(mediaRoot, plan.subfolder) },
      ...summary,
    },
    null,
    2,
  ),
);
if (!flag("apply")) {
  console.log(
    summary.conflicts.length
      ? "\nResolve the conflicts above, then run again with --apply."
      : "\nNothing was changed. Run again with --apply to import.",
  );
  process.exit(summary.conflicts.length ? 1 : 0);
}
try {
  const result = applyStudioImport(plan);
  console.log(
    `\nImported. Undo with: node backend/commands/import-studio.mjs --undo ${result.batch}\nManifest and backups: ${path.dirname(result.manifest)}`,
  );
} catch (error) {
  fail(error.message);
}
