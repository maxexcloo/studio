// First: the settings (.env), so every module below reads them.
import "./env.js";
// Then: keeps a copy of data/ before a new version's stores load and migrate it.
import "./data-snapshot.js";
// Then, once: Hidden's data backed up and its readable records back in the gallery.
import { createJobRecovery } from "./job-recovery.js";
import { installShutdown } from "./shutdown.js";
import {
  galleryJobResponse,
  registerGalleryReadRoutes,
  registerGalleryHistoryRoutes,
  registerGalleryErrorRoutes,
  registerGalleryDeleteRoute,
} from "./gallery/routes.js";
import { registerGenerationRoutes } from "./generation-routes.js";
import { createGenerationAdmission } from "./domain/admission.ts";
import { registerCompareRoutes } from "./domain/compare.ts";
import { createDream, registerDreamRoutes } from "./domain/dream.ts";
import { createFinishing, registerFinishingRoutes } from "./domain/finishing.ts";
import { fullBodyPerson } from "./mcp/prompt-checks.js";
import {
  createNextStepWork,
  createSuggestions,
  registerSuggestionRoutes,
} from "./domain/suggestions.ts";
import { createTaste, preferenceSignal, registerTasteRoutes, tasteSignal } from "./domain/taste.ts";
import { ChatStore } from "./domain/chat-store.ts";
import { ChatService } from "./domain/chat.ts";
import { createChatRouter } from "./domain/chat-routes.ts";
import { publicJob, queuePriority, Store } from "./domain/store.ts";
import { GenerationQueue } from "./domain/queue.ts";
import { createCaptioner } from "./domain/captions.ts";
import { createImageSearch, createImageVectors } from "./domain/image-search.ts";
import { registerIdlePassRoutes } from "./domain/idle-work.ts";
import { createTitler } from "./domain/titles.ts";
import { createPromptSuggester } from "./domain/suggested-prompts.ts";
import {
  readRuntimeDocument,
  runtimeDatabase,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";
import { createGenerationQueueAdapter } from "./domain/generation-adapter.ts";
import { createUpscaleQueueAdapter, withUpscaleAdapter } from "./domain/upscale-adapter.ts";
import { createCloudQueueAdapter, routeQueueAdapters } from "./domain/cloud-adapter.ts";
import { configuredCliProxy } from "./providers/cliproxy.ts";
import { providerMediaWriter } from "./providers/media.ts";
import { createSiglip, siglipVersion } from "./providers/siglip.ts";
import { readJsonFile, writeBytesFileAsync, writeJsonFile } from "./json-store.js";
import { withPngText } from "./png-text.js";
import { composeWorkflowPrompt } from "./graphs.js";
import { studioCloudProfiles } from "./providers/profiles.ts";
import { withResolution } from "../shared/resolution.ts";
import { pausedReason, terminalStatuses } from "../shared/queue.ts";
import {
  registerMaintenanceRoutes,
  registerRewriteRoutes,
  unconfirmedCancel,
} from "./domain/routes.ts";
import { loadRuntime, registerRuntimeStatus } from "./runtime/bootstrap.ts";
import { createLocalText, createServicesObserver } from "./runtime/services.ts";
import { registerModelDownloadRoutes } from "./model/download-routes.js";
import { accountMayUseLoras, createModelCatalogue, modelsForAccount } from "./model/catalogue.js";
import { registerModelRoutes } from "./model/routes.js";
import { registerStatusRoutes } from "./status-routes.js";
import { registerPresetRoutes } from "./preset-routes.js";
import { registerLibraryRoutes } from "./library/routes.js";
import {
  createEditableProfile,
  listEditableProfiles,
  profileIdTaken,
  readEditableProfile,
  registerProfileEditorRoutes,
  repointProfiles,
  validateProfileText,
} from "./profile/editor.js";
import { registerProfileRoutes } from "./profile/routes.js";
import { draftProfileFromImport } from "./profile/drafts.js";
import { seedSamples } from "./profile/seed.js";
import { createAssistant, draftedProfile } from "./assistant.js";
import { chatModelAllowed, chatSettings, servedChatModels } from "./chat-settings.js";
import { catalogDownloadsForFile } from "./catalog-downloads.js";
import { familyFromName } from "./family-catalog.js";
import {
  assistantIntegration,
  assistantSettingKeys,
  assistantSettingValue,
  downscaleReferences,
  registerAssistantRoutes,
} from "./assistant-routes.js";
import { createPromptStage, writingIssue, writingRequest } from "./prompt-stage.js";
import {
  canonicalProfileId,
  guideStore,
  livePrompting,
  profileAliasBackend,
  profileStore,
  withCanonicalProfile,
} from "./profile/store.js";

import { requireAdmin, requireLocal } from "./route-access.js";
import express from "express";
import {
  configuredBackends,
  currentComfyBackend,
  isDefaultBackend,
  profileOnBackendKey,
  readyWorkers,
  routeJob,
  withComfyBackend,
} from "./comfy/backends.js";
import {
  capabilityForProfile,
  defaultWorkerId,
  listWorkers,
  noWorkerMessage,
  useWorkloadWorkers,
  workerById,
} from "./workers.js";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  networkListening,
  demoMode,
  comfy,
  inDotFolder,
  localOutputFile,
  comfyUrl,
  host,
  noteComfyFetchError,
  noteComfyReachable,
  optionsFor,
  port,
  root,
  setListeningPort,
} from "./comfy/comfy.js";
import { canAdmin, clientOf } from "./access.js";
import { hostAllowed, requestGuard } from "./request-guard.js";
import { registerMcpRoutes } from "./mcp/mcp.js";
import { mcpOutputPath } from "./mcp/media.js";
import { stripMetadata } from "./metadata-strip.js";
import { loadSharp } from "./sharp-loader.js";
import { appVersion } from "./data-dir.js";
import { buildProfile, inferModels, mockModelResult, offlineModelResult } from "./model/models.js";
import { presetsEnabled } from "./features.js";
import {
  catalogueFlags,
  describeFlag,
  flagEnabled,
  isCatalogueFlag,
  saveDeploymentSetting,
  settingSource,
} from "./deployment-settings.js";
import { civitaiTokenStatus } from "./civitai/access.js";
import { hfFetch, hfTokenStatus } from "./hf-access.js";
import {
  deleteOwnedGalleryItems,
  filterVisibleGallery,
  flushGalleryStrict,
  isGalleryHidden,
  galleryKey,
  flushPendingGallery,
  replaceGalleryJob,
  makePendingItems,
  gallery,
  dataDir,
  recordsFromComfyHistory,
  saveGallery,
  setGallery,
  cleanupGalleryState,
  updateGalleryJob,
  galleryRevisionValue,
  storedWritingRecord,
  onGalleryFilesDeleted,
} from "./gallery/store.js";
import { getThumbnail } from "./thumbnails.js";
import {
  clearPromptHistory,
  forgetPrompts,
  listPrompts,
  promptHistoryEnabled,
  recordPrompt,
  setPromptHistoryEnabled,
  setPromptPinned,
} from "./prompt-history.js";
import { fillVideoSizes } from "./library/library.js";
import {
  getComfyVideoGif,
  getComfyVideoLoop,
  getComfyVideoPlayback,
  getComfyVideoPoster,
  getComfyVideoPreview,
  sendVideoPreview,
  sendVideoPoster,
} from "./video-previews.js";
import { derivedMediaCache, immutableMediaCache } from "./media-response.js";
import { startMediaWarmup } from "./media-warmup.js";
import { jobs, setTerminalJob } from "./jobs.js";
import { cancelPrompt } from "./comfy/queue.js";
import { catalogueLoraInfo, familiesFromMetadata, loraCatalogue, loraInfos } from "./lora/info.js";
import { optionalLoraPolicyIssue } from "./lora/catalogue.js";
import { strengthRange } from "./lora/policy.js";
import {
  deleteImportedWorkflow,
  getCustomWorkflow,
  loadCustomWorkflows,
  saveImportedWorkflow,
  userWorkflowsDir,
} from "./custom-workflows.js";
import {
  loadWorkflowPreferences,
  previewWorkflowImport,
  saveWorkflowPreferences,
  workflowSummaries,
} from "./workflow-catalog.js";
import { registerReferenceRoutes } from "./reference-routes.js";
import { registerVideoEditRoutes } from "./gallery/video-edits.js";
import { registerRecreateRoute } from "./gallery/recreate.js";

import {
  applyLoraOps,
  clearLoraState,
  loadLoraLibrary,
  loadLoraStack,
  saveLoraLibrary,
  saveLoraStack,
} from "./lora/stacks.js";
import {
  bytesForReferenceAccount,
  galleryStill,
  referenceAssetForAccount,
  referenceExistsForAccount,
  stageReferenceAssetsForAccount,
} from "./references.js";
import {
  normalizeQuality,
  upscaleQualities,
  upscaleTargets,
  upscaleStatus,
  uploadUpscaleVideoSource,
} from "./upscale.js";
import {
  findUpscaleTarget,
  prepareUpscale,
  runUpscaleJob,
  toggleUpscaleView,
} from "./upscale-jobs.js";
import { compressJson, serveApp } from "./http-assets.js";
import {
  isMediaUrl,
  mediaRoot,
  mediaSubfolder,
  mediaType,
  outputMediaPattern,
  videoPattern,
} from "./media-paths.js";
import { gatedPath } from "./gated-path.js";
import { ingestRecords, ingestRunResults, noteIngested, removeComfyFiles } from "./media-store.js";
import { forgetComfyRun } from "./comfy/traces.js";
import {
  accountForRequest,
  internalMcpHeaders,
  multiUserEnabled,
  registerMultiUserAuthRoutes,
} from "./multi-user-auth.js";
import { enforceMultiUserRequest } from "./multi-user-gate.js";
import {
  ownerIdForRequest,
  outputFilenameBelongsToRequest,
  recordBelongsToAccount,
  recordBelongsToRequest,
  recordsForRequest,
} from "./account-ownership.js";
import { isCloudProfile, mayUseFeature, mayUseGenerationProfile } from "./account-policy.js";
import {
  accountAccessForId,
  gatewayAccountAccess,
  gatewayAdminTools,
  listAccounts,
  noteGatewayIdentity,
  verifyAccountMcpToken,
} from "./account-store.js";

let drainServer = async () => {};
installShutdown({ drain: () => drainServer(), flush: flushPendingGallery });

const app = express();
// Routes match exactly as written. Express otherwise matches /API/… to /api/… while every gate
// checks the lowercase prefix, so a capitalised path would reach handlers ungated.
app.set("case sensitive routing", true);
// Before anything reads a body: other websites and rebound hostnames stop here (request-guard.js).
app.use(requestGuard({ network: networkListening }));
async function resolveSignedMcpResult(owner, jobId, index) {
  if (!accountAccessForId(owner)?.authenticated) return null;
  const item = gallery.find(
    (entry) =>
      entry.ownerId === owner &&
      entry.jobId === jobId &&
      entry.index === index &&
      entry.status === "done",
  );
  if (!item || !mcpOutputPath(item.url)) return null;
  const source = new URL(item.url, "http://localhost");
  const filename = source.searchParams.get("filename") || "";
  const subfolder = source.searchParams.get("subfolder") || "";
  const type = source.searchParams.get("type") || "output";
  const request = { studioAccount: { userId: owner } };
  if (
    !ownerMediaTypes.has(type) ||
    !outputMediaPattern.test(filename) ||
    inDotFolder(subfolder) ||
    !outputFilenameBelongsToRequest(filename, subfolder, request)
  )
    return null;
  try {
    const backend = item.settings?.comfyBackend || defaultWorkerId();
    // Studio media is read from its folder only, whichever worker made it.
    const file = localOutputFile(filename, subfolder, type);
    if (type === mediaType && !file) return null;
    const bytes = file
      ? await fs.promises.readFile(file)
      : await withComfyBackend(backend, () =>
          comfy(
            `/view?${new URLSearchParams({ filename, ...(subfolder ? { subfolder } : {}), type })}`,
            { timeout: 120000 },
          ),
        );
    const extension = path.extname(filename).toLowerCase();
    const mime = {
      ".jpeg": "image/jpeg",
      ".jpg": "image/jpeg",
      ".m4v": "video/mp4",
      ".mkv": "video/x-matroska",
      ".mov": "video/quicktime",
      ".mp4": "video/mp4",
      ".png": "image/png",
      ".webm": "video/webm",
      ".webp": "image/webp",
    }[extension];
    return mime ? { content: Buffer.from(bytes), mime } : null;
  } catch {
    return null;
  }
}
// Once per start and safe to repeat: the samples seed an empty data folder, then the catalogue
// and profile stores take in what the older files hold, which stay where they are
// (profile/seed.js, library/catalogue.js, profile/store.js).
for (const [name, migrate] of [
  ["seed", () => seedSamples({ dataDir, workflowsDir: userWorkflowsDir, store: profileStore() })],
  ["catalogue", () => loraCatalogue().migrate()],
  ["profiles", () => profileStore().migrate()],
]) {
  try {
    migrate();
  } catch (error) {
    console.warn(
      `[Studio] The ${name} store couldn’t take in the older files yet: ${error.message}`,
    );
  }
}
// GPU deployments Studio scales (runtime/bootstrap.ts); the control MCP tools and Settings › Workers drive it.
const runtime = await loadRuntime(process.env, { dataDir });
if (runtime) useWorkloadWorkers(runtime.controller.workloads);
// The local text route while a local text workload runs; without a runtime, text takes the cloud route.
const localText = runtime ? createLocalText({ controller: runtime.controller }) : undefined;
const mcp = registerMcpRoutes(app, {
  dataDir,
  runtime: runtime?.controller,
  gatewayAdminTools,
  baseUrl: () => `http://127.0.0.1:${port}`,
  allowedHost: (req) => hostAllowed(req.headers.host, { network: networkListening }),
  accountMode: multiUserEnabled,
  authenticateAccountToken: verifyAccountMcpToken,
  authenticateGatewayIdentity: gatewayAccountAccess,
  noteGatewayIdentity,
  internalCredential: internalMcpHeaders,
  resolveSignedResult: resolveSignedMcpResult,
  domainRequest: mcpGenerationRequest,
  cloudVideoFailures: (since) =>
    store
      .failedJobs("provider:cliproxyapi:", new Date(since).toISOString())
      .filter((job) => job.input.kind === "video")
      .map((job) => ({ reason: job.reason, at: Date.parse(job.updatedAt) })),
});
app.use(express.json({ limit: "25mb" }));
const cloudProvider = configuredCliProxy();
const directCloud =
  cloudProvider &&
  studioCloudProfiles({
    provider: cloudProvider,
    workflows: loadCustomWorkflows,
    buildProfile,
    accountForOwner: accountAccessForId,
    mayUseProfile: mayUseGenerationProfile,
    composePrompt: composeWorkflowPrompt,
    reference: async (account, id) =>
      (await bytesForReferenceAccount(account || undefined, id)).buffer,
  });
// A body that is not valid JSON, or too big, gets a plain JSON answer, not Express's HTML page with a stack trace and file paths.
app.use((error, _req, res, next) => {
  if (!error || (error.type !== "entity.parse.failed" && error.type !== "entity.too.large"))
    return next(error);
  res.status(error.type === "entity.too.large" ? 413 : 400).json({
    ok: false,
    error:
      error.type === "entity.too.large"
        ? "That request is too large."
        : "That request wasn't valid JSON.",
  });
});
// Gallery pages and model lists travel compressed to phones and tablets; this computer skips the work.
app.use(compressJson({ skip: (req) => clientOf(req).thisComputer }));
const store = new Store(runtimeDatabase(dataDir));
// The media catalogue across every worker, and each worker's ComfyUI context (model/catalogue.js).
const catalogue = createModelCatalogue({ store, runtime, directCloud });
const {
  catalogueModels,
  comfyDownMessage,
  loadComfyContext,
  mediaModels,
  presetModels,
  unavailableModels,
  workerWorkloads,
} = catalogue;

const recoverRunningJobs = createJobRecovery({
  backends: configuredBackends,
  finishJob: (id, patch) => {
    setTerminalJob(id, patch);
  },
  getGallery: () => gallery,
  jobs,
  recordsFromHistory: recordsFromComfyHistory,
  request: comfy,
  setGallery,
  visible: filterVisibleGallery,
  withBackend: withComfyBackend,
  cancel: cancelPrompt,
  ingest: (records, promptId) => ingestRecoveredRecords(records, promptId ? [promptId] : []),
});

/**
 * Recovered ComfyUI outputs move into Studio media and
 * leave ComfyUI. ComfyUI's copies go only after the caller has put the records
 * in the gallery and it is on disk.
 */
async function ingestRecoveredRecords(records, promptIds = []) {
  if (!records.length) return records;
  const moved = await ingestRecords(records);
  if (moved.comfyFiles.length) {
    const backend = currentComfyBackend();
    const ids = [
      ...new Set([...promptIds, ...records.map((item) => item.promptId).filter(Boolean)]),
    ];
    setTimeout(
      () =>
        withComfyBackend(backend, async () => {
          await flushGalleryStrict();
          const inGallery = new Set(gallery.map((item) => item.url));
          // Nothing that did not make it into the gallery loses its ComfyUI copy.
          if (
            !moved.records.every(
              (record) => !record.url || inGallery.has(record.url) || !isMediaUrl(record.url),
            )
          )
            return;
          noteIngested(records.map((item) => item.jobId));
          await removeComfyFiles(moved.comfyFiles);
          if (ids.length) await forgetComfyRun({ promptIds: ids }).catch(() => false);
        }).catch(() => null),
      0,
    );
  }
  return moved.records;
}
setInterval(() => recoverRunningJobs(), 5000).unref();

async function recoverGalleryFromHistory() {
  // Recovery follows only jobs already recorded in this runtime's gallery.
  await recoverRunningJobs();
  cleanupGalleryState(jobs);
}

/**
 * The gate for everyone else. Account mode needs an account; single-user mode
 * answers only this computer (a proxy always counts as someone else).
 */
function requireSignedIn(req, res, next) {
  if (!gatedPath(req.path)) return next();
  if (multiUserEnabled) return enforceMultiUserRequest(req, res, next, { accountForRequest });
  if (clientOf(req).thisComputer) return next();
  res.status(403).json({
    ok: false,
    reason: "this-computer",
    error:
      "Only this computer can open this single-user Studio. Use account mode (STUDIO_MULTI_USER=1) for other devices.",
  });
}

app.use(requireSignedIn);
registerRuntimeStatus(
  app,
  runtime,
  (req, res, next) => {
    if (requireAdmin(req, res)) next();
  },
  (req) => (req.studioAccount?.userId ? `account:${req.studioAccount.userId}` : "local"),
);
const observeServices = createServicesObserver({
  workers: listWorkers,
  controller: runtime?.controller,
});
registerStatusRoutes(app, { observeServices, store });
// Grantable profiles come from the same discovery as /api/models, across image and video backends.
// Cloud profiles are granted by the Cloud Models feature, so they are listed apart.
const discoveredProfiles = async () => {
  const models = await mediaModels(false)
    .then((result) => result.models)
    .catch(() => (demoMode ? mockModelResult() : offlineModelResult(comfyUrl)));
  return models.profiles || [];
};
registerMultiUserAuthRoutes(app, {
  availableProfiles: async () =>
    (await discoveredProfiles())
      .filter((profile) => !isCloudProfile(profile))
      .map((profile) => profile.id),
  cloudProfiles: async () =>
    (await discoveredProfiles()).filter(isCloudProfile).map((profile) => profile.id),
});

// Accounts read their own outputs: ComfyUI's output folder, or Studio-owned media.
const ownerMediaTypes = new Set(["output", mediaType]);

registerModelRoutes(app, { catalogue, libraryUpdates: () => library.updates });

registerModelDownloadRoutes(app, { loadComfyContext });
const presetRoutes = registerPresetRoutes(app, { models: presetModels });
// The Library (library/routes.js): imports, their records and grades, and what is installed with its provenance.
const unique = (...lists) => [
  ...new Set(lists.flat().filter((name) => typeof name === "string" && name)),
];
/** Each saved profile definition: its name, declared family and text. */
async function profileDefinitions() {
  const names = await fs.promises.readdir(userWorkflowsDir).catch(() => []);
  const definitions = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const text = await fs.promises
      .readFile(path.join(userWorkflowsDir, name), "utf8")
      .catch(() => "");
    let block = {};
    try {
      const parsed = JSON.parse(text);
      block = parsed.studio || {};
    } catch {
      /* Unreadable definitions still count as naming the files they mention. */
    }
    definitions.push({
      name: name.replace(/\.json$/, ""),
      family: String(block.family || ""),
      text,
    });
  }
  return definitions;
}
/** What still uses a model file, so an update removes the old one only when nothing does (Decision 4). */
async function modelFileReferences({ file }) {
  if (!file) return [];
  const quoted = JSON.stringify(file);
  const users = (await profileDefinitions())
    .filter((definition) => definition.text.includes(quoted))
    .map((definition) => `the ${definition.name} profile`);
  for (const profile of (await presetModels().catch(() => ({ profiles: [] }))).profiles || []) {
    if (
      [profile.defaults?.model, profile.model, profile.baseModel].includes(file) &&
      !users.includes(`the ${profile.id} profile`)
    )
      users.push(`the ${profile.displayName || profile.label || profile.id} profile`);
  }
  const stacks = [path.join(dataDir, "lora-stacks.json")];
  try {
    for (const owner of await fs.promises.readdir(path.join(dataDir, "accounts")))
      stacks.push(path.join(dataDir, "accounts", owner, "lora-stacks.json"));
  } catch {
    /* Single-user. */
  }
  let saved = 0;
  for (const stack of stacks)
    if ((await fs.promises.readFile(stack, "utf8").catch(() => "")).includes(quoted)) saved += 1;
  if (saved) users.push(saved === 1 ? "a saved LoRA stack" : `${saved} saved LoRA stacks`);
  return users;
}
const library = registerLibraryRoutes(app, {
  presets: presetRoutes,
  catalogue: loraCatalogue,
  draftProfile: (record, options) => draftCheckpointProfile(record, options),
  families: (baseModel) => familiesFromMetadata({ base_model: String(baseModel || "") }),
  loraInfo: (names) => loraInfos(names),
  installed: async () => {
    const { info } = await loadComfyContext();
    return {
      loras: optionsFor(info, "LoraLoader", "lora_name"),
      checkpoints: optionsFor(info, "CheckpointLoaderSimple", "ckpt_name"),
      diffusion_models: unique(
        optionsFor(info, "UNETLoader", "unet_name"),
        optionsFor(info, "UnetLoaderGGUF", "unet_name"),
      ),
      text_encoders: unique(
        optionsFor(info, "CLIPLoader", "clip_name"),
        optionsFor(info, "CLIPLoaderGGUF", "clip_name"),
      ),
      vae: optionsFor(info, "VAELoader", "vae_name"),
      clip_vision: optionsFor(info, "CLIPVisionLoader", "clip_name"),
    };
  },
  // Lookup says which ready profiles a link's base model fits.
  readyProfiles: async () =>
    ((await mediaModels(false)).models.profiles || [])
      .filter((profile) => profile.ready !== false)
      .map(({ id, family }) => ({ id, family })),
  profiles: async () =>
    ((await presetModels()).profiles || []).map((profile) => ({
      id: profile.id,
      label: profile.displayName || profile.label || profile.id,
      kind: profile.kind,
      family: profile.family || "",
      familyName: profile.familyName || "",
      model: profile.defaults?.model || profile.model || "",
    })),
  familiesOf: (name) => familiesFromMetadata({ base_model: String(name || "") }),
  gguf: async () => Boolean((await loadComfyContext()).info?.UnetLoaderGGUF),
  // The assistant registers below; the Library asks for it only when describing an image.
  assistant: () => assistantEngine,
  repoint: async (from, to) => repointProfiles(from.file, to.file),
  references: modelFileReferences,
  profileDefinitions,
  schedule: !demoMode,
});

/** Ordinary accounts see only their permitted workflows, without server paths or delete handles. */
function workflowsForRequest(req, workflows) {
  if (!req.studioAccount || canAdmin(req)) return workflows;
  return workflows
    .filter((item) =>
      mayUseGenerationProfile(req.studioAccount, {
        id: item.profileId,
        family: item.family,
        uncensored: item.uncensored,
        aiDrafted: item.aiDrafted,
      }),
    )
    .map(({ path: _path, deleteId: _deleteId, ...item }) => item);
}

app.get("/api/workflows", async (req, res) => {
  try {
    const { info, stats } = await loadComfyContext().catch(() => ({ info: {}, stats: {} }));
    const models = Object.keys(info || {}).length
      ? inferModels(info, stats)
      : demoMode
        ? mockModelResult()
        : offlineModelResult(comfyUrl);
    const preferences = loadWorkflowPreferences();
    res.json({
      workflows: workflowsForRequest(
        req,
        workflowSummaries({ info, profiles: models.profiles, preferences }),
      ),
      preferences,
    });
  } catch {
    const models = demoMode ? mockModelResult() : offlineModelResult(comfyUrl);
    const preferences = loadWorkflowPreferences();
    res.json({
      workflows: workflowsForRequest(
        req,
        workflowSummaries({ info: {}, profiles: models.profiles, preferences }),
      ),
      preferences,
    });
  }
});

app.post("/api/workflows/import/preview", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const raw = req.body?.workflow || req.body;
    const { info } = await loadComfyContext().catch(() => ({ info: {} }));
    res.json({ ok: true, preview: previewWorkflowImport(raw, req.body?.filename || "", info) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/workflows/import", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const raw = req.body?.workflow || req.body;
    const { info } = await loadComfyContext().catch(() => ({ info: {} }));
    // The review's own notes (the node list, what was guessed) aren't part of the workflow.
    const { nodes: _nodes, guessed: _guessed, ...metadata } = req.body?.metadata || {};
    const normalized =
      (Array.isArray(raw?.nodes) && Array.isArray(raw?.links)) || raw?.prompt
        ? {
            graph: previewWorkflowImport(raw, req.body?.filename || "", info).graph,
            studio: metadata,
          }
        : raw;
    const workflow = saveImportedWorkflow(normalized, metadata);
    const { graph: _graph, ...summary } = workflow;
    res.json({ ok: true, workflow: summary });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

const profileObjectInfo = async (kind) =>
  (
    await withComfyBackend(
      routeJob(kind === "video" ? "video" : "image")?.id || defaultWorkerId(),
      () => loadComfyContext(),
    )
  ).info;
registerProfileEditorRoutes(app, {
  objectInfo: profileObjectInfo,
  accountName: (req) => req.studioAccount?.userId || "",
});
// Settings › Profiles: versions, revert, approve, guides and the export bundle (profile/routes.js).
registerProfileRoutes(app, {
  profiles: () => profileStore(),
  guides: () => guideStore(),
  objectInfo: profileObjectInfo,
  accountName: (req) => req.studioAccount?.userId || "",
  exportOptions: () => ({
    dataDir,
    workflowsDir: userWorkflowsDir,
    catalogue: loraCatalogue(),
    manifestFile: loraCatalogue().manifestFile?.() || "",
    studioVersion: appVersion,
  }),
});

/**
 * A checkpoint or diffusion model import's AI-drafted profile and guide (profile/drafts.js): the
 * nearest same-family profile as template, parts through Download Missing, checked against
 * ComfyUI's object_info before it is written. Administrators only until approved.
 */
async function draftCheckpointProfile(record, options) {
  return draftProfileFromImport(record, options, {
    templates: () =>
      listEditableProfiles()
        .filter((item) => item.readable)
        .map((item) => {
          try {
            return { ...item, raw: JSON.parse(readEditableProfile(item.id).text) };
          } catch {
            return null;
          }
        })
        .filter(Boolean),
    info: () => profileObjectInfo("image"),
    families: (baseModel) => familiesFromMetadata({ base_model: String(baseModel || "") }),
    familyFromName: (file) => familyFromName(file),
    taken: profileIdTaken,
    downloadsFor: catalogDownloadsForFile,
    engine: assistantEngine,
    draftedProfile,
    validate: validateProfileText,
    create: (id, text, { by }) =>
      createEditableProfile(id, text, {
        by,
        origin: "ai",
        aiDrafted: true,
        info: null,
        note: `Drafted from import ${record.id}`,
      }),
    guides: guideStore(),
  });
}

// The prompt assistant (assistant-routes.js): account-scoped, behind the Prompt Assistant feature.
const assistantGuides = (() => {
  try {
    return livePrompting();
  } catch (error) {
    console.warn(`[Studio] The prompt assistant has no guides: ${error.message}`);
    return () => null;
  }
})();
const assistantProfiles = async (req) => {
  try {
    return modelsForAccount(await catalogueModels(), req).profiles || [];
  } catch {
    return [];
  }
};
const assistantLoras = async (req) => {
  if (!accountMayUseLoras(req)) return [];
  try {
    const names = optionsFor((await loadComfyContext()).info, "LoraLoader", "lora_name");
    const infos = await loraInfos(names);
    return names.map((name) => ({ name, info: infos[name] || { families: [], triggers: [] } }));
  } catch {
    return [];
  }
};
const assistantGuide = (profile) => {
  try {
    return assistantGuides(profile);
  } catch {
    return null;
  }
};
const assistantEngine = registerAssistantRoutes(app, {
  localText,
  frame: (req, id) => assistantImage(req.studioAccount, id),
  profiles: assistantProfiles,
  guide: assistantGuide,
  loras: assistantLoras,
  // Learning from stars: the account's six newest starred prompts on the same family, and their LoRAs.
  starred: async (req, profile) => {
    const families = new Map((await assistantProfiles(req)).map((item) => [item.id, item.family]));
    const same = (item, id = canonicalProfileId(item.settings?.profileId)) =>
      id === profile.id || (profile.family && families.get(id) === profile.family);
    const items = gallery
      .filter(
        (item) =>
          item.favorite &&
          item.status === "done" &&
          item.prompt &&
          recordBelongsToRequest(item, req) &&
          same(item),
      )
      .slice(0, 6);
    return {
      examples: items.map((item) => item.prompt),
      loras: [
        ...new Set(
          items.flatMap((item) =>
            (item.settings?.loras || []).map((lora) => lora?.name).filter(Boolean),
          ),
        ),
      ],
    };
  },
});

app.delete("/api/workflows/:id", (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const result = deleteImportedWorkflow(req.params.id.replace(/^custom:/, ""));
    const preferences = loadWorkflowPreferences();
    preferences.favorites = preferences.favorites.filter(
      (id) => id !== `custom:${result.id}` && id !== result.id,
    );
    delete preferences.lastUsed[`custom:${result.id}`];
    saveWorkflowPreferences(preferences);
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

registerGalleryReadRoutes(app, {
  near: (text) => imageSearch.near(text),
  jobChats: (req) => {
    const ownerId = ownerIdForRequest(req);
    const titles = new Map(store.sessions(ownerId).map((chat) => [chat.id, chat.title]));
    return new Map(
      store
        .jobs(ownerId)
        .map((job) => [job.id, { id: job.sessionId, title: titles.get(job.sessionId) }]),
    );
  },
});

app.delete("/api/loras", (req, res) => {
  if (!requireLocal(req, res)) return;
  clearLoraState(ownerIdForRequest(req));
  res.json({ ok: true });
});

app.get("/api/loras/library", (req, res) => {
  if (!accountMayUseLoras(req))
    return res.json({ found: false, library: { strengths: {}, snapshots: {} } });
  const library = loadLoraLibrary(ownerIdForRequest(req));
  res.json({ found: library !== null, library: library || { strengths: {}, snapshots: {} } });
});

app.put("/api/loras/library", (req, res) => {
  if (!accountMayUseLoras(req))
    return res.status(403).json({ ok: false, error: "LoRA access is disabled for this account." });
  try {
    res.json({ ok: true, library: saveLoraLibrary(req.body?.library, ownerIdForRequest(req)) });
  } catch (error) {
    res.status(500).json({ ok: false, error: `Couldn’t save the LoRA library: ${error.message}` });
  }
});

// Clients send edits, not whole copies, so two devices never overwrite each other.
app.post("/api/loras/library/ops", (req, res) => {
  if (!accountMayUseLoras(req))
    return res.status(403).json({ ok: false, error: "LoRA access is disabled for this account." });
  try {
    res.json({ ok: true, library: applyLoraOps(req.body?.ops, ownerIdForRequest(req)) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

// What each LoRA ComfyUI lists was trained for and its trigger words, from the files themselves.
app.get("/api/loras/info", async (_req, res) => {
  if (!accountMayUseLoras(_req)) return res.json({ ok: true, loras: {} });
  try {
    const { info } = await loadComfyContext();
    res.json({ ok: true, loras: await loraInfos(optionsFor(info, "LoraLoader", "lora_name")) });
  } catch (error) {
    res.status(503).json({ ok: false, loras: {}, error: comfyDownMessage(error?.message) });
  }
});

app.get("/api/loras/:workflowId", (req, res) => {
  if (!accountMayUseLoras(req)) return res.json({ found: false, loras: [] });
  const loras = loadLoraStack(req.params.workflowId, ownerIdForRequest(req));
  res.json({ found: loras !== null, loras: loras || [] });
});

app.put("/api/loras/:workflowId", (req, res) => {
  if (!accountMayUseLoras(req))
    return res.status(403).json({ ok: false, error: "LoRA access is disabled for this account." });
  try {
    res.json({
      ok: true,
      loras: saveLoraStack(req.params.workflowId, req.body?.loras, ownerIdForRequest(req)),
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

// Taste profiles (domain/taste.ts) learn from stars, compare votes and iterations on a result.
// A gone or disabled account's prompts never reach the text model.
const tasteWriter = (ownerId) =>
  ownerId && !accountAccessForId(ownerId)?.authenticated ? null : assistantEngine;
// Text takes the cloud route whenever no local text worker runs (assistant.js), so a configured
// gateway is always reachable; a stopped or parked local worker never makes text unavailable.
const textOnline = async () => Boolean(assistantEngine);
const tasteStore = createTaste({ dataDir, writer: tasteWriter, online: textOnline });
// Signals name a merged profile by the id it goes by now (profile/merge.js).
const taste = {
  ...tasteStore,
  record: (ownerId, signals) =>
    tasteStore.record(
      ownerId,
      signals.map((signal) =>
        signal.profileId ? { ...signal, profileId: canonicalProfileId(signal.profileId) } : signal,
      ),
    ),
};
// Every admitted job teaches the taste profile (iterations) and makes waiting Dream work step aside.
const jobAdmitted = (job) => {
  if (job.parentJobId) taste.record(job.ownerId, [tasteSignal("iterate", job.id, job.input)]);
  dream.admitted(job);
  finishing.admitted(job);
  captioner.interrupt();
  imageSearch.interrupt();
  titler.interrupt();
  suggester.interrupt();
  nextSteps.interrupt();
};
registerGalleryHistoryRoutes(app, {
  starred: (req, items, favorite) => {
    const ownerId = ownerIdForRequest(req);
    if (favorite)
      dream.starred(
        ownerId,
        items.map((item) => item.id),
      );
    finishing.starred(
      ownerId,
      items.map((item) => item.id),
      favorite,
    );
    taste.record(
      ownerId,
      items.map((item) =>
        tasteSignal(favorite ? "star" : "unstar", item.jobId, {
          ...item.settings,
          prompt: item.prompt,
        }),
      ),
    );
  },
});

app.get("/api/prompts", (req, res) => {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  const ownerId = ownerIdForRequest(req);
  res.json({
    prompts: listPrompts(req.query.kind, ownerId),
    enabled: promptHistoryEnabled(req.query.kind, ownerId),
  });
});

app.post("/api/prompts/enabled", (req, res) => {
  const ownerId = ownerIdForRequest(req);
  const prompts = setPromptHistoryEnabled(req.body?.enabled !== false, ownerId);
  res.json({ ok: true, prompts, enabled: promptHistoryEnabled("positive", ownerId) });
});

app.post("/api/prompts/pin", (req, res) => {
  res.json({
    ok: true,
    prompts: setPromptPinned(
      String(req.body?.text || ""),
      Boolean(req.body?.pinned),
      req.body?.kind,
      ownerIdForRequest(req),
    ),
  });
});

// The prompt assistant keeps the text it replaced (a rewrite, a written negative), so History can bring it back.
app.post("/api/prompts/record", (req, res) => {
  const kind = req.body?.kind === "negative" ? "negative" : "positive";
  const ownerId = ownerIdForRequest(req);
  recordPrompt(String(req.body?.text || "").slice(0, 8000), kind, ownerId);
  res.json({ ok: true, prompts: listPrompts(kind, ownerId) });
});

app.post("/api/prompts/forget", (req, res) => {
  res.json({
    ok: true,
    prompts: forgetPrompts(
      [String(req.body?.text || "")],
      new Set(),
      req.body?.kind,
      ownerIdForRequest(req),
    ),
  });
});

app.post("/api/prompts/clear", (req, res) => {
  res.json({
    ok: true,
    prompts: clearPromptHistory(
      { keepPinned: req.body?.keepPinned !== false },
      req.body?.kind,
      ownerIdForRequest(req),
    ),
  });
});

/**
 * A thumbnail's caching. The gallery asks for every thumbnail with a `v` that
 * names its item (mediaUrl.ts), so a reused file name is a new address: that
 * one is used straight from the browser's cache for a while and checked again
 * in the background after, so a reload or a scroll back sends no requests and
 * a file changed in place still shows up on the next look. Without `v` the
 * address is only a file name, so it is checked every time.
 */
function thumbnailCacheControl(req) {
  if (req.query.type === mediaType) return derivedMediaCache;
  return req.query.v ? "private, max-age=600, stale-while-revalidate=2592000" : "private, no-cache";
}

// An upload is searchable at once, like a finished generation.
registerReferenceRoutes(app, { uploaded: (item) => void imageSearch.completed([item]) });
registerVideoEditRoutes(app, { store });
registerRecreateRoute(app, { store });

/**
 * What the deployment decides, for Settings: each value with its source
 * (deployment, this studio's .env, or the default) and whether it is locked.
 */
app.get("/api/settings/deployment", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.setHeader("Cache-Control", "no-store");
  const models = await mediaModels(false)
    .then((result) => result.models)
    .catch(() => unavailableModels());
  const profiles = (models.profiles || []).map((profile) => ({
    id: profile.id,
    label: profile.displayName || profile.label || profile.id,
    kind: profile.kind,
    ready: profile.ready !== false,
  }));
  const defaultFor = (key, effective) => ({
    key,
    configured: process.env[key] || "",
    effective: effective || "",
    ...settingSource(key),
  });
  res.json({
    ok: true,
    defaults: {
      image: defaultFor("STUDIO_DEFAULT_IMAGE_PROFILE", models.defaults?.imageModel),
      video: defaultFor("STUDIO_DEFAULT_VIDEO_PROFILE", models.defaults?.videoModel),
      profiles,
    },
    catalogue: catalogueFlags.map(describeFlag),
    integrations: {
      civitai: { token: civitaiTokenStatus(), presets: presetsEnabled() },
      huggingFace: { token: hfTokenStatus() },
      assistant: await assistantIntegration({ engine: assistantEngine, source: settingSource }),
    },
  });
});

app.post("/api/settings/deployment", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const key = String(req.body?.key || "");
  const value = req.body?.value;
  try {
    if (isCatalogueFlag(key)) {
      if (typeof value !== "boolean") throw new Error("Choose on or off.");
      const item = catalogueFlags.find((entry) => entry.key === key);
      // Back to the default is no saved value at all, so a later default change still applies.
      res.json({
        ok: true,
        setting: {
          ...saveDeploymentSetting(key, value === item.defaultOn ? "" : value ? "1" : "0"),
          key,
        },
      });
      return;
    }
    if (assistantSettingKeys.includes(key)) {
      res.json({
        ok: true,
        setting: {
          ...saveDeploymentSetting(key, assistantSettingValue(key, value)),
          key,
        },
      });
      return;
    }
    if (key === "STUDIO_DEFAULT_IMAGE_PROFILE" || key === "STUDIO_DEFAULT_VIDEO_PROFILE") {
      const id = String(value || "").trim();
      if (id.length > 256 || /[\r\n]/.test(id)) throw new Error("Choose a valid profile.");
      res.json({ ok: true, setting: { ...saveDeploymentSetting(key, id), key } });
      return;
    }
    res.status(400).json({ ok: false, error: "That setting cannot be changed here." });
  } catch (error) {
    res
      .status(error.message.includes("deployment configuration") ? 409 : 400)
      .json({ ok: false, error: error.message });
  }
});

// Demo mode's placeholder profiles stand in for ComfyUI, as /api/models does.
const generationRoutes = registerGenerationRoutes(app, {
  loadComfyContext,
  mediaModels: (force) =>
    mediaModels(force).catch((error) => {
      if (demoMode) return { models: mockModelResult() };
      throw error;
    }),
  comfyDownMessage,
});

// This runtime owns only the IDs persisted in its own SQLite queue and gallery.
const mediaLeases = new Map();
// Manual work goes to the first worker that can run it; background work (MCP, Dream, finishing)
// prefers a worker that also runs video, keeping the first free for manual work.
async function queueResourceFor(input, priority = queuePriority.manual) {
  if (directCloud?.isProfile(input)) return "provider:cliproxyapi";
  const models = await mediaModels(false)
    .then((result) => result.models)
    .catch(() => (demoMode ? mockModelResult() : { profiles: [] }));
  const profile = models.profiles?.find((item) => item.id === canonicalProfileId(input.profileId));
  const capability = profile
    ? capabilityForProfile(profile)
    : input.kind === "video"
      ? "video"
      : "image";
  const worker = routeJob(capability, {
    profileId: profileOnBackendKey(input.profileId, input.profileBackend),
    prefers: priority > queuePriority.manual ? ["video"] : [],
  });
  // Only a worker that can run the job holds it (generation-routes.js ignores any other pin);
  // background work goes where it is routed, whatever worker its source input names.
  const backend =
    priority === queuePriority.manual &&
    typeof input.backendId === "string" &&
    workerById(input.backendId)?.capabilities.includes(capability)
      ? input.backendId
      : worker?.id || defaultWorkerId() || "";
  return `worker:${backend}`;
}
/** The deployments that can serve a job's worker; one- and two-GPU video share its address. */
function managedWorkloads(job) {
  if (job.resource.startsWith("provider:cliproxyapi")) return [];
  return workerWorkloads(workerById(job.backend));
}
async function permitQueueFallback(job) {
  if (job.input.allowFallback !== true) return false;
  const models = await mediaModels(false)
    .then((result) => result.models)
    .catch(() => null);
  const profile = models?.profiles.find(
    (item) => item.id === canonicalProfileId(job.input.profileId),
  );
  const backend = profile?.workerIds?.find((id) => id !== job.backend);
  if (!backend) return false;
  const latest = store.job(job.ownerId, job.id);
  store.save({
    ...latest,
    backend,
    resource: `worker:${backend}`,
  });
  return true;
}
const queueAdapter = createGenerationQueueAdapter({
  generate: generationRoutes.generate,
  jobs,
  gallery: () => gallery,
  accountForOwner: accountAccessForId,
  flushGallery: flushGalleryStrict,
  durableSave: async (job) => {
    const records = gallery.filter(
      (item) =>
        item.jobId === job.id && item.status === "done" && (item.ownerId || "") === job.ownerId,
    );
    const moved = await withComfyBackend(job.backend, () =>
      ingestRunResults(
        records.map((item) => ({
          output: item,
          ...(item.upscale?.url ? { upscale: item.upscale } : {}),
        })),
        job.ownerId,
        { strict: true },
      ),
    );
    for (const result of moved.results)
      updateGalleryJob(result.output.id, {
        ...result.output,
        ...(result.upscale ? { upscale: result.upscale } : {}),
      });
    await flushGalleryStrict();
    const live = jobs.get(job.id);
    if (live && (live.ownerId || "") === job.ownerId)
      jobs.set(job.id, {
        ...live,
        status: "done",
        error: "",
        outputs: gallery.filter(
          (item) =>
            item.jobId === job.id && item.status === "done" && (item.ownerId || "") === job.ownerId,
        ),
      });
    if (moved.comfyFiles.length)
      await withComfyBackend(job.backend, async () => {
        await removeComfyFiles(moved.comfyFiles);
        if (job.providerJobId)
          await forgetComfyRun({ promptIds: [job.providerJobId] }).catch(() => false);
      });
  },
  cancelPrompt: ({ promptId, backend }) => withComfyBackend(backend, () => cancelPrompt(promptId)),
  recover: async (job) => {
    if ((job.providerJobId || job.cancelRequested) && !jobs.has(job.id))
      jobs.set(job.id, {
        status: job.cancelRequested ? "canceling" : "running",
        recovered: true,
        promptId: job.providerJobId,
        comfyBackend: job.backend,
        ownerId: job.ownerId || undefined,
      });
    await recoverRunningJobs();
  },
  eligible: async (job) => {
    if (demoMode) return;
    if (!job.backend || !workerById(job.backend)) {
      if (await permitQueueFallback(job))
        return "Moving to another worker with explicit fallback permission.";
      return "Waiting for the selected worker to be configured.";
    }
    const workloads = managedWorkloads(job);
    try {
      if (workloads.length && !mediaLeases.has(job.id))
        mediaLeases.set(job.id, await runtime.controller.acquire(workloads));
      await withComfyBackend(job.backend, () => loadComfyContext());
    } catch (error) {
      mediaLeases.get(job.id)?.release();
      mediaLeases.delete(job.id);
      if (await permitQueueFallback(job))
        return "Moving to another worker with explicit fallback permission.";
      return error.message;
    }
  },
  settled: async (job) => {
    if (job.status === "failed") updateGalleryJob(job.id, { status: "error", error: job.reason });
    if (job.status === "cancelled") updateGalleryJob(job.id, { status: "canceled" });
    mediaLeases.get(job.id)?.release();
    mediaLeases.delete(job.id);
  },
});
// Reconstruct leases synchronously before the HTTP listener accepts work.
for (const job of store
  .jobs()
  .filter(
    (item) =>
      !terminalStatuses.has(item.status) &&
      (["starting", "running", "saving"].includes(item.status) || item.providerJobId),
  )) {
  const workloads = managedWorkloads(job);
  if (workloads.length) mediaLeases.set(job.id, runtime.controller.retain(workloads));
}
const directCloudAdapter =
  directCloud &&
  createCloudQueueAdapter({
    store,
    provider: cloudProvider,
    resolve: directCloud.resolve,
    saveMedia: providerMediaWriter(mediaRoot, mediaSubfolder, writeBytesFileAsync, withPngText),
    saveGallery: async (job, outputs, request) => {
      await replaceGalleryJob(
        job.id,
        outputs,
        {
          ...job.input,
          kind: request.kind,
          ownerId: job.ownerId,
          model: job.input.model || job.input.profileId,
          modelName: request.model,
          comfyBackend: "cliproxyapi",
          width: outputs[0]?.width || request.width,
          height: outputs[0]?.height || request.height,
          duration: request.duration,
          resolution: request.resolution,
        },
        jobs,
      );
      await flushGalleryStrict();
    },
  });
const upscaleQueueAdapter = createUpscaleQueueAdapter({
  store,
  jobs,
  itemFor: (ownerId, itemId) =>
    gallery.find((item) => item.id === itemId && (item.ownerId || "") === ownerId),
  execute: (job, callbacks) =>
    withComfyBackend(job.backend, async () => {
      const account = job.ownerId ? accountAccessForId(job.ownerId) : undefined;
      if (!job.providerJobId && job.ownerId && !account?.authenticated)
        throw new Error("This account can no longer upscale images.");
      const info = job.providerJobId ? null : (await loadComfyContext()).info;
      return runUpscaleJob(job.id, job.input.upscaleBody, info, undefined, {
        ...callbacks,
        promptId: job.providerJobId,
        plan: job.input.upscalePlan,
      });
    }),
  cancelPrompt: (promptId, backend) => withComfyBackend(backend, () => cancelPrompt(promptId)),
  flushGallery: flushGalleryStrict,
  eligible: queueAdapter.eligible,
  settled: async (job) => {
    const item = gallery.find(
      (entry) => entry.id === job.input.galleryItemId && (entry.ownerId || "") === job.ownerId,
    );
    if (item && item.upscale?.jobId === job.id && ["failed", "cancelled"].includes(job.status))
      updateGalleryJob(item.id, {
        upscale: {
          ...item.upscale,
          status: job.status === "failed" ? "error" : "canceled",
          error: job.reason,
          progress: null,
        },
      });
    await queueAdapter.settled(job);
  },
});
/** A reference image as the text model reads it ({ mime, data }, downscaled), or null. */
async function assistantImage(account, id) {
  if (!id) return null;
  const reference = await bytesForReferenceAccount(account, id);
  const [image] = await downscaleReferences([
    `data:${reference.mime};base64,${reference.buffer.toString("base64")}`,
  ]);
  return image || null;
}
// The queue's writing stage (prompt-stage.js): prompts the assistant writes for a generation.
const promptStage = createPromptStage({
  engine: assistantEngine,
  account: (ownerId) => {
    const account = ownerId ? accountAccessForId(ownerId) : undefined;
    return ownerId && !account?.authenticated ? null : account;
  },
  profiles: (account) => assistantProfiles({ studioAccount: account }),
  guide: assistantGuide,
  dream: () => dream,
  frame: assistantImage,
});
const generationAdapter = withUpscaleAdapter(
  directCloudAdapter ? routeQueueAdapters(queueAdapter, directCloudAdapter) : queueAdapter,
  upscaleQueueAdapter,
);
const generationQueue = new GenerationQueue(
  store,
  {
    ...generationAdapter,
    // A local generation may move to another idle worker that runs it: the forms fill in a
    // worker by default, so it is where the job starts rather than a pin.
    alternatives: (job) =>
      job.resource.startsWith("worker:") && job.operation !== "upscale"
        ? readyWorkers(
            job.input.kind === "video" ? "video" : "image",
            profileOnBackendKey(job.input.profileId, job.input.profileBackend),
          ).map((worker) => `worker:${worker.id}`)
        : [],
    settled: async (job) => {
      await generationAdapter.settled(job);
      if (job.status !== "completed") return;
      const items = gallery.filter(
        (item) => item.jobId === job.id && (item.ownerId || "") === job.ownerId,
      );
      void titler.completed(items);
      void imageSearch.completed(items);
    },
  },
  promptStage,
);
async function validateGenerationInput(input, account) {
  if (input.writing === undefined) return validateGeneration(input, account);
  if (typeof input.writing?.prompt === "string") {
    // Already written (a Dream variation): the record goes with the prompt it explains.
    const record = storedWritingRecord(input.writing);
    if (record) input.writing = { ...record, prompt: input.writing.prompt };
    else delete input.writing;
    return validateGeneration(input, account);
  }
  // Written in the queue: only the request is admitted, and the rest is checked as it will run,
  // with a stand-in for the prompt still to be written.
  input.writing = writingRequest(input.writing);
  const issue = writingIssue(input.writing, { engine: assistantEngine, account });
  if (issue) return { status: issue.status, payload: { ok: false, error: issue.error } };
  input.prompt = "(written by the prompt assistant)";
  try {
    return await validateGeneration(input, account);
  } finally {
    input.prompt = "";
  }
}
async function validateGeneration(input, account) {
  // A per-backend id merged into a combined profile runs on the backend it named.
  const named = profileAliasBackend(input.profileId);
  // A merged profile's old id (a reused result, preset or MCP call) runs and is stored as the kept one.
  for (const key of ["profileId", "model", "workflow"])
    if (typeof input[key] === "string") input[key] = canonicalProfileId(input[key]);
  // The backend a combined profile's run uses, stored with it: the one asked for while the profile
  // still defines it, else its current one. Any other profile runs without one.
  const combined =
    typeof input.profileId === "string" && input.profileId.startsWith("custom:")
      ? getCustomWorkflow(input.profileId)
      : null;
  const wanted = input.profileBackend || named;
  if (combined?.backendIds?.length)
    input.profileBackend = combined.backendIds.includes(wanted) ? wanted : combined.backend;
  else delete input.profileBackend;
  // Every path (composer, Chat, Compare, Dream, MCP) draws at its size tier, 1K unless it names one.
  const sized = (await mediaModels().catch(() => null))?.models?.profiles?.find(
    (profile) => profile.id === input.profileId,
  );
  Object.assign(input, withResolution(input, sized));
  if (directCloud?.isProfile(input)) {
    try {
      await directCloud.resolve({ ownerId: account?.userId || "", input });
      return { status: 200, payload: { ok: true } };
    } catch (error) {
      return { status: error.status || 400, payload: { ok: false, error: error.message } };
    }
  }
  return generationRoutes.validateInput(input, account);
}
// Accounts without the prompt assistant get the fallback title; their prompts never reach the text model.
function chatTitle(account, sessionId, prompt) {
  return sessionChat.title(account?.userId || "", sessionId, prompt);
}
registerRewriteRoutes(app, {
  store,
  queue: generationQueue,
  resourceFor: queueResourceFor,
  validate: validateGenerationInput,
  deleteMedia: deleteOwnedGalleryItems,
  media: (ownerId) => {
    const byJob = new Map();
    for (const item of gallery)
      if (item.jobId && (item.ownerId || "") === ownerId && !isGalleryHidden(item))
        byJob.set(item.jobId, [...(byJob.get(item.jobId) || []), item]);
    for (const items of byJob.values()) items.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return byJob;
  },
  title: chatTitle,
  admitted: jobAdmitted,
});
registerMaintenanceRoutes(app, { store, queue: generationQueue, requireAdmin });
const admitGeneration = createGenerationAdmission({
  store,
  queue: generationQueue,
  resourceFor: queueResourceFor,
  pendingItems: makePendingItems,
  revision: galleryRevisionValue,
  validate: validateGenerationInput,
  admitted: jobAdmitted,
});
const comparisonsFile = path.join(dataDir, "comparisons.json");
registerCompareRoutes(app, {
  store,
  admit: admitGeneration,
  cancel: (ownerId, jobId) => generationQueue.cancel(ownerId, jobId),
  read: () => {
    try {
      return readJsonFile(comparisonsFile);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  },
  write: (records) => writeJsonFile(comparisonsFile, records),
  gallery: (req) => recordsForRequest(filterVisibleGallery(gallery), req),
  pendingItems: makePendingItems,
  voted: (ownerId, jobId, others) => {
    const values = (id) => {
      const item = gallery.find((entry) => entry.jobId === id && (entry.ownerId || "") === ownerId);
      return store.job(ownerId, id)?.input || { ...item?.settings, prompt: item?.prompt };
    };
    const winner = { jobId, values: values(jobId) };
    taste.record(ownerId, [
      tasteSignal("compare", jobId, winner.values),
      ...others.map((id) => preferenceSignal(winner, { jobId: id, values: values(id) })),
    ]);
  },
  title: chatTitle,
});
registerTasteRoutes(app, { taste });
/** Whether text work (Chat replies, admitted local text) is running now; Dream and captions wait for it. */
const textBusy = () =>
  Boolean(
    runtime?.controller
      .status()
      .some((workload) => workload.kind === "text" && workload.acceptedOperations > 0) ||
    store.db
      .prepare(
        "SELECT 1 FROM studio_chat_messages WHERE json_extract(record, '$.status') = 'streaming' LIMIT 1",
      )
      .get(),
  );
// Suggestions (domain/suggestions.ts): composer ideas, viewer next steps and Chat context from taste.
const suggestions = createSuggestions({
  taste,
  writer: tasteWriter,
  online: textOnline,
  uncensored: (ownerId) => {
    const account = ownerId ? accountAccessForId(ownerId) : undefined;
    return (
      !ownerId || Boolean(account?.authenticated && mayUseFeature(account, "uncensoredModels"))
    );
  },
  item: (ownerId, jobId) =>
    filterVisibleGallery(
      gallery.filter((entry) => entry.jobId === jobId && (entry.ownerId || "") === ownerId),
    )[0],
  // The viewer asks by job, so every result of the run keeps the same steps.
  save: (item, nextSteps) => updateGalleryJob(item.jobId, { nextSteps }),
});
registerSuggestionRoutes(app, { suggestions });
// Dream (domain/dream.ts): idle-time results from the taste profile, off until an account turns it on.
// It only queues work; GPU placement stays with AI Control and cloud profiles never take part.
const dream = createDream({
  dataDir,
  store,
  taste,
  owners: () => (multiUserEnabled ? listAccounts().map((account) => account.id) : [""]),
  access: (ownerId) => {
    const account = ownerId ? accountAccessForId(ownerId) : undefined;
    if (ownerId && !account?.authenticated) return null;
    return { account, uncensored: !account || mayUseFeature(account, "uncensoredModels") };
  },
  catalogue: async (_ownerId, account) => {
    const models = modelsForAccount((await mediaModels(false)).models, { studioAccount: account });
    return {
      profiles: (models.profiles || []).filter(
        (profile) =>
          profile.ready !== false &&
          !["offline", "parked"].includes(profile.availability) &&
          !isCloudProfile(profile),
      ),
      defaults: models.defaults,
    };
  },
  online: async (kind) => {
    const { services } = await observeServices({ allowed: [kind] });
    const reach = (state) => (["offline", "parked"].includes(state) ? state : "online");
    return {
      text: (await textOnline()) ? "online" : "offline",
      media: reach(services[kind]?.state),
    };
  },
  textBusy,
  writer: assistantEngine,
  guide: assistantGuide,
  gallery: (ownerId) =>
    gallery.filter((item) => (item.ownerId || "") === ownerId).map(withCanonicalProfile),
  visible: filterVisibleGallery,
  // Only the owner's own record: updateGalleryJob alone matches any account's item.
  mark: (ownerId, itemId, mark) => {
    if (!gallery.some((item) => item.id === itemId && (item.ownerId || "") === ownerId))
      throw new Error("That Dream result is unavailable.");
    updateGalleryJob(itemId, { dream: mark });
  },
  loraLibrary: (ownerId) => {
    const account = ownerId ? accountAccessForId(ownerId) : undefined;
    if (account && !mayUseFeature(account, "loras")) return null;
    return loadLoraLibrary(ownerId);
  },
  // As submit validation (validation.js) would judge them: another family's LoRA is dropped.
  fitLoras: (profile, loras) =>
    loras.flatMap((lora) => {
      const info = catalogueLoraInfo(lora.name);
      const range = strengthRange(info);
      const strength = range
        ? Math.min(range.max, Math.max(range.min, lora.strength))
        : lora.strength;
      return optionalLoraPolicyIssue({ name: lora.name, strength }, info, profile)
        ? []
        : [{ ...lora, strength }];
    }),
  reference: (account, itemId) => referenceAssetForAccount(account, itemId),
  admit: admitGeneration,
  cancel: (ownerId, jobId) => generationQueue.cancel(ownerId, jobId),
});
registerDreamRoutes(app, { dream });
// Dream's idle rule (domain/dream.ts), with Dream's own jobs counting as work: no live job, no text work.
const studioIdle = () =>
  !textBusy() &&
  !store.db
    .prepare(
      "SELECT 1 FROM studio_queue WHERE status NOT IN ('completed', 'failed', 'cancelled') LIMIT 1",
    )
    .get();
// Finish Starred Images (domain/finishing.ts): idle-time smart upscales of what an account stars.
const finishing = createFinishing({
  dataDir,
  store,
  owners: () => (multiUserEnabled ? listAccounts().map((account) => account.id) : [""]),
  allowed: (ownerId) => {
    if (!ownerId) return !multiUserEnabled;
    const account = accountAccessForId(ownerId);
    return Boolean(account?.authenticated);
  },
  item: (ownerId, itemId) =>
    gallery.find((item) => item.id === itemId && (item.ownerId || "") === ownerId),
  idle: studioIdle,
  ready: async (quality) => {
    const worker = routeJob("upscale");
    if (!worker) return { reason: noWorkerMessage("upscale") };
    return withComfyBackend(worker.id, async () => {
      const { info, failure } = await upscaleInfo();
      if (failure) return { reason: failure.payload.error };
      const status = upscaleStatus(info, quality);
      if (!status.ready) return { reason: upscaleUnready(status) };
      return {
        faceDetail: status.faceDetail.nodesInstalled && status.faceDetail.detectors.length > 0,
      };
    });
  },
  fullBody: fullBodyPerson,
  upscale: (ownerId, request) =>
    queueUpscale(ownerId ? accountAccessForId(ownerId) : undefined, request, {
      priority: queuePriority.finishing,
    }),
  cancel: (ownerId, jobId) => generationQueue.cancel(ownerId, jobId),
});
registerFinishingRoutes(app, { finishing });
// A gone or disabled account's gallery never reaches the text model.
function promptAssistantOwner(ownerId) {
  if (!multiUserEnabled) return true;
  return Boolean(ownerId && accountAccessForId(ownerId)?.authenticated);
}
/** A small (≤512 px) JPEG of a gallery image (a video's first frame) for the text model, or null without sharp. */
async function smallImage(item) {
  const sharp = await loadSharp();
  if (!sharp) return null;
  const data = await sharp(await galleryStill(item))
    .rotate()
    .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return { mime: "image/jpeg", data: data.toString("base64") };
}
// Gallery captions (domain/captions.ts) let search match what an image shows.
const runtimeLoad = (name) => () => {
  try {
    return readRuntimeDocument(dataDir, name);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};
const captioner = createCaptioner({
  enabled: () => flagEnabled("STUDIO_GALLERY_CAPTIONS"),
  writer: assistantEngine,
  idle: studioIdle,
  allowed: promptAssistantOwner,
  items: () => gallery,
  visible: (item) => filterVisibleGallery([item]).length > 0,
  image: smallImage,
  save: (item, caption) => updateGalleryJob(galleryKey(item), { caption }),
  load: runtimeLoad("captions"),
  persist: (document) => writeRuntimeDocument(dataDir, "captions", document),
});
registerIdlePassRoutes(app, "/api/gallery/captions", { work: captioner, requireAdmin });
// Image search (domain/image-search.ts): SigLIP 2 on the CPU, so search finds what images show.
const imageSearch = createImageSearch({
  // Demo images are placeholders, and demo test runs must not download the model.
  enabled: () => !demoMode && flagEnabled("STUDIO_IMAGE_SEARCH"),
  encoder: createSiglip({ dataDir, fetch: hfFetch }),
  vectors: createImageVectors(runtimeDatabase(dataDir), siglipVersion),
  idle: studioIdle,
  items: () => gallery,
  visible: (item) => filterVisibleGallery([item]).length > 0,
  image: galleryStill,
  load: runtimeLoad("image-search"),
  persist: (document) => writeRuntimeDocument(dataDir, "image-search", document),
});
registerIdlePassRoutes(app, "/api/gallery/embeddings", { work: imageSearch, requireAdmin });
onGalleryFilesDeleted((items) => imageSearch.forget(items));
// Gallery titles (domain/titles.ts): a few words from the prompt, shown as the item's title.
const titler = createTitler({
  writer: assistantEngine,
  idle: studioIdle,
  allowed: promptAssistantOwner,
  items: () => gallery,
  visible: (item) => filterVisibleGallery([item]).length > 0,
  save: (item, title) => updateGalleryJob(galleryKey(item), { title }),
});
// Suggested prompts (domain/suggested-prompts.ts) for items without one, such as uploads; Recreate uses them.
const suggester = createPromptSuggester({
  writer: assistantEngine,
  idle: studioIdle,
  allowed: promptAssistantOwner,
  items: () => gallery,
  visible: (item) => filterVisibleGallery([item]).length > 0,
  image: smallImage,
  save: (item, suggestedPrompt) => updateGalleryJob(galleryKey(item), { suggestedPrompt }),
});
// Viewer next steps (domain/suggestions.ts), written while idle so the viewer shows them at once.
const nextSteps = createNextStepWork({
  suggestions,
  writer: assistantEngine,
  idle: studioIdle,
  allowed: promptAssistantOwner,
  items: () => gallery,
  visible: (item) => filterVisibleGallery([item]).length > 0,
  image: smallImage,
});
generationRoutes.setAdmission(async (req, res) => {
  const result = await admitGeneration(req.body || {}, req.studioAccount);
  res.status(result.status).json(result.payload);
});

/** The catalogue profile a Chat draft names, if any. */
async function chatProfile(input) {
  const models = await catalogueModels();
  return models.profiles?.find((item) => item.id === canonicalProfileId(input?.profileId));
}
async function selectedChatMediaProfile(input, operation) {
  const profile = await chatProfile(input);
  const reject = (message) => {
    throw Object.assign(new Error(message), { status: 400 });
  };
  if (!profile) reject("Choose an available generation model before asking Chat to create media.");
  const kind = operation === "animate" ? "video" : "image";
  if ((profile.kind || "image") !== kind)
    reject(
      `Choose a ${kind} model for this action; the selected model will not be changed automatically.`,
    );
  if (
    operation !== "image" &&
    !(
      profile.capabilities?.startImage ||
      profile.imageModes?.reference ||
      profile.mediaInputs?.length
    )
  )
    reject("Choose a model that supports image references for this action.");
  return profile;
}
let chatGateway;
const sessionChat = new ChatService({
  store: new ChatStore(store.db),
  settings: chatSettings,
  // Chat already requires the prompt assistant; the taste writer check keeps the two in step.
  taste: (ownerId) => (tasteWriter(ownerId) ? taste.read(ownerId).summary : ""),
  session: (ownerId, id) => store.session(ownerId, id),
  // Studio's MCP server for this chat, in process: the tools and rules LibreChat gets.
  agent: (ownerId, sessionId, owned) =>
    mcp.agent({
      owner: ownerId,
      account: ownerId ? accountAccessForId(ownerId) : undefined,
      session: sessionId,
      ...owned,
    }),
  results: (ownerId, sessionId) =>
    store.jobs(ownerId, sessionId).map((job) => ({
      id: job.id,
      status: job.status,
      kind: job.input.kind,
      profile: job.input.profileId,
      prompt: job.input.prompt,
    })),
  // A text workload's model reads images as its workloads say; Bifrost's cloud models all do.
  vision: async (modelId) => {
    const served = (runtime?.controller.workloads || []).filter(
      (item) =>
        item.kind === "text" &&
        item.model &&
        // A workload model without a provider prefix matches only itself, not every model.
        (item.model.includes("/")
          ? modelId.startsWith(item.model.slice(0, item.model.lastIndexOf("/") + 1))
          : modelId === item.model),
    );
    return served.length ? served.every((item) => item.vision === true) : true;
  },
  models: async (ownerId) => {
    const settings = chatSettings();
    if (!settings) return [];
    const account = ownerId ? accountAccessForId(ownerId) : undefined;
    if (ownerId && !account?.authenticated) return [];
    chatGateway ||= createAssistant(process.env, { resolveSettings: chatSettings });
    const models = ((await chatGateway?.listModelDetails()) || []).filter((model) =>
      chatModelAllowed(model.id, settings.patterns),
    );
    const workloads = (runtime?.controller.workloads || []).filter(
      (item) =>
        item.kind === "text" && item.model && chatModelAllowed(item.model, settings.patterns),
    );
    if (!workloads.length) return models;
    // Only administrators may start a stopped model, as in Settings › Workers.
    const admin = !multiUserEnabled || account?.role === "administrator";
    const phases = admin
      ? undefined
      : Object.fromEntries(
          (await runtime.controller.observe()).workloads.map(({ id, phase }) => [id, phase]),
        );
    return servedChatModels(models, workloads, phases);
  },
  revision: async (ownerId, sessionId, revision) => {
    const source = store.job(ownerId, revision.sourceJobId);
    if (!source || source.sessionId !== sessionId)
      throw Object.assign(new Error("Source generation not found."), { status: 404 });
    const account = ownerId ? accountAccessForId(ownerId) : undefined;
    if (ownerId && !account?.authenticated)
      throw Object.assign(new Error("This account is unavailable."), { status: 403 });
    const kind = revision.operation === "animate" ? "video" : "image";
    if (revision.input.kind && revision.input.kind !== kind)
      throw Object.assign(new Error("The selected operation does not match the media kind."), {
        status: 400,
      });
    const input = { ...revision.input, kind };
    const profile = await selectedChatMediaProfile(input, revision.operation);
    const startImage = input.startImageId || input.startImage;
    if (startImage && !referenceExistsForAccount(account, startImage))
      throw Object.assign(new Error("The start image does not belong to this account."), {
        status: 400,
      });
    if (!input.referenceAssets?.length && startImage)
      input.referenceAssets = [
        { assetId: startImage, slot: profile.mediaInputs?.[0]?.id || "reference" },
      ];
    if (revision.operation !== "image" && !input.referenceAssets?.length)
      throw Object.assign(
        new Error("Choose a reference image before submitting a refinement or animation."),
        { status: 400 },
      );
    if (input.referenceAssets !== undefined && !Array.isArray(input.referenceAssets))
      throw Object.assign(new Error("Choose reference images as an array."), { status: 400 });
    for (const reference of input.referenceAssets || [])
      if (
        !reference ||
        typeof reference.assetId !== "string" ||
        !referenceExistsForAccount(account, reference.assetId)
      )
        throw Object.assign(new Error("Choose reference images belonging to this account."), {
          status: 400,
        });
    const checked = await validateGenerationInput(input, account || undefined);
    if (checked.status >= 400)
      throw Object.assign(new Error(checked.payload.error), { status: checked.status });
    return {
      sourceJobId: source.id,
      operation: revision.operation,
      input,
      previousInput: source.input,
    };
  },
  reference: async (ownerId, id) => {
    const account = ownerId ? accountAccessForId(ownerId) : undefined;
    if (ownerId && !account?.authenticated)
      throw Object.assign(new Error("This account no longer has access."), { status: 403 });
    const image = await assistantImage(account, id);
    if (!image)
      throw Object.assign(new Error("This reference image cannot be used by Chat."), {
        status: 400,
      });
    return `data:${image.mime};base64,${image.data}`;
  },
  // A card revision, already checked by `revision`, runs exactly as submitted.
  admit: async ({ ownerId, sessionId, turnId, draft }) => {
    const account = ownerId ? accountAccessForId(ownerId) : undefined;
    if (ownerId && !account?.authenticated)
      throw Object.assign(new Error("This account is unavailable."), { status: 403 });
    const result = await admitGeneration(
      {
        ...draft.input,
        kind: draft.operation === "animate" ? "video" : "image",
        clientJobId: turnId,
        allowFallback: draft.input.allowFallback === true,
      },
      account || undefined,
      { sessionId, operation: draft.operation, parentJobId: draft.parentJobId },
    );
    if (result.status >= 400)
      throw Object.assign(new Error(result.payload.error || "Generation could not be started."), {
        status: result.status,
      });
    return { job: publicJob(store.job(ownerId, result.payload.jobId)) };
  },
});
app.use("/api", createChatRouter(sessionChat, ownerIdForRequest));

// Only generation and its owned results use direct domain calls; other MCP tools retain their transport.
async function mcpGenerationRequest(method, route, input, owner) {
  const url = new URL(route, "http://localhost");
  const jobMatch = method === "GET" && url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
  const galleryMatch = method === "GET" && url.pathname.match(/^\/api\/gallery\/jobs\/([^/]+)$/);
  if (!(method === "POST" && url.pathname === "/api/generate") && !jobMatch && !galleryMatch)
    return undefined;
  const account = multiUserEnabled ? accountAccessForId(owner) : undefined;
  if (multiUserEnabled && !account?.authenticated)
    return { status: 401, payload: { ok: false, error: "This account no longer has access." } };
  if (jobMatch)
    return {
      status: 200,
      payload: generationJobResponse(account, decodeURIComponent(jobMatch[1])),
    };
  if (galleryMatch)
    return galleryJobResponse(
      account,
      decodeURIComponent(galleryMatch[1]),
      url.searchParams.get("settings") === "1",
    );
  const { queueSet, studioSession, ...body } = input || {};
  // Studio Chat's agent queues into its chat as the person's own work, made from the result it reuses.
  if (studioSession) {
    const parent = studioSession.parent && store.job(owner, studioSession.parent);
    const parentJobId = parent?.sessionId === studioSession.id ? parent.id : undefined;
    return admitGeneration(
      body,
      account,
      {
        sessionId: studioSession.id,
        operation:
          body.kind === "video"
            ? "animate"
            : parentJobId && body.referenceAssets?.length
              ? "refine"
              : "image",
        parentJobId,
      },
      { priority: queuePriority.manual, queueSet },
    );
  }
  // External chat work queues after manual Studio requests; its set keeps it together once started.
  return admitGeneration(body, account, undefined, { priority: queuePriority.mcp, queueSet });
}
generationQueue.start();
dream.start();
finishing.start();
captioner.start();
imageSearch.start();
titler.start();
suggester.start();
nextSteps.start();

/**
 * Upscaling runs on a worker with Upscale (workers.js): the routes below run
 * inside its scope, so its node list, uploads and the job itself all go there.
 */
function onUpscaleWorker(handler) {
  return (req, res) => {
    const worker = routeJob("upscale");
    if (!worker) {
      const { status, payload } = noUpscaleWorker();
      res.status(status).json(payload);
      return undefined;
    }
    return withComfyBackend(worker.id, () => handler(req, res));
  };
}
const noUpscaleWorker = () => ({
  status: 503,
  payload: {
    ok: false,
    offline: true,
    noWorker: true,
    error: noWorkerMessage("upscale"),
  },
});

/** `force` reads ComfyUI again instead of the 30s cache. */
async function upscaleInfo({ force = false } = {}) {
  try {
    return { info: (await loadComfyContext({ force })).info };
  } catch {
    return {
      failure: {
        status: 503,
        payload: {
          ok: false,
          offline: true,
          error: `${isDefaultBackend() ? "ComfyUI" : workerById(currentComfyBackend())?.name || "The upscale worker"} is offline, so smart upscale isn’t available.`,
        },
      },
    };
  }
}
const upscaleUnready = (status) =>
  status.nodesInstalled
    ? "The SeedVR2 models aren’t installed yet."
    : `ComfyUI is missing the SeedVR2 nodes: ${status.missingNodes.join(", ")}.`;
async function upscaleContext(res, options) {
  const { info, failure } = await upscaleInfo(options);
  if (failure) res.status(failure.status).json(failure.payload);
  return info || null;
}

app.get(
  "/api/upscale/status",
  onUpscaleWorker(async (req, res) => {
    const info = await upscaleContext(res, { force: req.query.fresh === "1" });
    if (!info) return;
    const status = {
      ...upscaleStatus(info, req.query.quality),
      qualities: upscaleQualities,
      targets: upscaleTargets,
    };
    res.json({ ok: true, ...status });
  }),
);

/**
 * Queues a smart upscale of one of the account's gallery items on a worker with Upscale, answering
 * `{ status, payload }` as the route sends it. `origin` sets the queue tier (Finish Starred Images).
 */
async function queueUpscale(account, request, origin) {
  const worker = routeJob("upscale");
  if (!worker) return noUpscaleWorker();
  return withComfyBackend(worker.id, () => queueUpscaleOnWorker(account, request, origin));
}

async function queueUpscaleOnWorker(account, request, origin) {
  const target = request.target === undefined ? 0 : Number(request.target);
  if (target !== 0 && !upscaleTargets.includes(target)) {
    return {
      status: 400,
      payload: {
        ok: false,
        error: "Choose an upscale target of 2048 or 4096, or 0 for automatic sizing.",
      },
    };
  }
  const { info, failure } = await upscaleInfo();
  if (failure) return failure;
  const quality = normalizeQuality(request.quality);
  const itemId = String(request.galleryItemId || "");
  const ownedItem = gallery.find(
    (item) => item.id === itemId && recordBelongsToAccount(item, account),
  );
  if (account && !ownedItem)
    return {
      status: 404,
      payload: { ok: false, reason: "missing", error: "This image is no longer in the gallery." },
    };
  const faceDetail =
    Boolean(request.faceDetail) && (ownedItem || findUpscaleTarget(itemId))?.type !== "video";
  const status = upscaleStatus(info, quality);
  if (!status.ready)
    return {
      status: 400,
      payload: { ok: false, error: upscaleUnready(status), status },
    };
  if (faceDetail && !status.faceDetail.nodesInstalled)
    return {
      status: 400,
      payload: {
        ok: false,
        error: `Face detail needs the Impact Pack nodes: ${status.faceDetail.missingNodes.join(", ")}.`,
      },
    };
  // Say exactly why an image cannot be upscaled; the tile shows this in a popover.
  const item = findUpscaleTarget(itemId);
  if (!item)
    return {
      status: 404,
      payload: {
        ok: false,
        reason: "missing",
        error:
          "This image is no longer in the gallery. It may have been deleted on another device. Reload the page.",
      },
    };
  if (!["image", "video"].includes(item.type))
    return {
      status: 400,
      payload: { ok: false, reason: "video", error: "Upscale supports gallery images and videos." },
    };
  if (item.status !== "done")
    return {
      status: 409,
      payload: {
        ok: false,
        reason: "unfinished",
        error: "This image is still rendering. Upscale it when it’s done.",
      },
    };
  if (["queued", "running"].includes(item.upscale?.status))
    return { status: 409, payload: { ok: false, error: "This image is already being upscaled." } };
  let imageName = "";
  let upscaleItem = item;
  try {
    if (item.type === "video") {
      imageName = await uploadUpscaleVideoSource(item);
    } else {
      const asset = referenceAssetForAccount(account, item.id);
      const [staged] = await stageReferenceAssetsForAccount(account, [
        { assetId: asset.id, slot: "upscale", source: asset.source },
      ]);
      imageName = staged?.comfyName || "";
      if (staged) {
        if (
          !(
            Number.isFinite(staged.width) &&
            staged.width > 0 &&
            Number.isFinite(staged.height) &&
            staged.height > 0
          )
        )
          throw new Error("The source image dimensions could not be read.");
        upscaleItem = { ...item, width: staged.width, height: staged.height };
      }
    }
  } catch (error) {
    return {
      status: 400,
      payload: {
        ok: false,
        reason: "source",
        error: `Couldn’t read the original image: ${error.message}`,
      },
    };
  }
  if (!imageName)
    return {
      status: 502,
      payload: {
        ok: false,
        reason: "source",
        error:
          "ComfyUI didn’t accept the original image. Make sure ComfyUI is running and can write to its input folder.",
      },
    };
  const customWorkflow = String(item.model || "").startsWith("custom:")
    ? getCustomWorkflow(item.model, item.settings?.profileBackend)
    : null;
  const { body, plan } = prepareUpscale({
    item: upscaleItem,
    imageName,
    quality,
    target,
    faceDetail,
    info,
    customWorkflow,
  });
  const ownerId = account?.userId || "";
  const parent = item.jobId && store.job(ownerId, item.jobId);
  const session = parent
    ? store.session(ownerId, parent.sessionId)
    : store.createSession(ownerId, "Upscale", { prompt: item.prompt || "" });
  const queued = store.enqueue(
    ownerId,
    session.id,
    {
      prompt: item.prompt || "",
      galleryItemId: item.id,
      upscaleBody: body,
      upscalePlan: plan,
    },
    "upscale",
    parent?.id,
    `worker:${currentComfyBackend()}`,
    undefined,
    origin,
  );
  updateGalleryJob(item.id, {
    upscale: { ...item.upscale, status: "queued", jobId: queued.id, progress: null, error: "" },
  });
  finishing.admitted(queued);
  void generationQueue.tick().catch(() => undefined);
  return {
    status: 200,
    payload: { ok: true, jobId: queued.id, plan, revision: galleryRevisionValue() },
  };
}

app.post("/api/upscale", async (req, res) => {
  const { status, payload } = await queueUpscale(req.studioAccount, req.body || {});
  res.status(status).json(payload);
});

app.post("/api/upscale/toggle", (req, res) => {
  try {
    const itemId = String(req.body?.galleryItemId || "");
    const ownedItem = recordsForRequest(gallery, req).find((item) => item.id === itemId);
    if (req.studioAccount && !ownedItem)
      return res.status(404).json({ ok: false, error: "This image is no longer in the gallery." });
    const item = toggleUpscaleView(itemId, req.body?.active);
    res.json({
      ok: true,
      upscaleActive: Boolean(item.upscaleActive),
      revision: galleryRevisionValue(),
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

function generationJobResponse(account, id) {
  const queued = store.job(account?.userId || "", id);
  if (queued && !jobs.has(id)) {
    const status =
      {
        completed: "done",
        failed: "error",
        cancelled: "canceled",
        writing: "queued",
        waiting: "queued",
        starting: "queued",
        saving: "running",
      }[queued.status] || queued.status;
    return {
      status,
      items: queued.items,
      outputs: queued.outputs,
      error: queued.status === "failed" ? queued.reason : undefined,
      // A paused queue's hold is the one waiting reason a chat hears.
      ...(queued.reason === pausedReason ? { reason: pausedReason } : {}),
      // The prompt's thinking stays in Studio; a chat hears only the status.
      progress: queued.status === "writing" ? undefined : queued.progress,
      ...(queued.resource.startsWith("provider:cliproxyapi")
        ? { provider: "cliproxyapi", kind: queued.input.kind, updatedAt: queued.updatedAt }
        : {}),
    };
  }
  const job = jobs.get(id);
  if (!job || (account && job.ownerId !== account.userId)) {
    return { status: "missing" };
  }
  return { ...job, items: job.items || [] };
}
app.get("/api/jobs/:id", (req, res) => {
  res.json(generationJobResponse(req.studioAccount, req.params.id));
});

app.post("/api/jobs/:id/cancel", async (req, res) => {
  if (store.job(ownerIdForRequest(req), req.params.id)) {
    try {
      await generationQueue.cancel(ownerIdForRequest(req), req.params.id);
    } catch {
      return res.status(503).json({
        ok: false,
        error: unconfirmedCancel,
      });
    }
    return res.json({ ok: true });
  }
  const job = jobs.get(req.params.id);
  if (!job) {
    // Nothing here runs it any more (Studio restarted): only the tile is left to settle.
    // Its prompt id went with the job, so ComfyUI is left alone rather than interrupted blindly.
    const hasOwnedRecord = recordsForRequest(gallery, req).some(
      (item) => item.jobId === req.params.id,
    );
    if (!hasOwnedRecord) return res.json({ ok: true, stale: true, changed: false });
    const changed = updateGalleryJob(req.params.id, { status: "canceled" });
    res.json({ ok: true, stale: true, changed });
    return;
  }
  // Another account's live job answers exactly like an unknown one.
  if (req.studioAccount && job.ownerId !== req.studioAccount.userId)
    return res.json({ ok: true, stale: true, changed: false });
  jobs.set(req.params.id, { ...job, status: "canceling" });
  // Its pictures are saved and only Smart upscale is left: they stay, and runJob delivers them.
  if (!job.keepsPicture) updateGalleryJob(req.params.id, { status: "canceled" });
  // Without a prompt id yet, runJob takes it back out of ComfyUI as soon as /prompt answers.
  if (job.promptId)
    await withComfyBackend(job.comfyBackend, () => cancelPrompt(job.promptId)).catch(() => null);
  res.json({ ok: true });
});

app.post("/api/queue/cancel", async (req, res) => {
  const ownerId = ownerIdForRequest(req);
  for (const pending of store
    .jobs(ownerId)
    .filter((job) => ["writing", "queued", "waiting"].includes(job.status)))
    await generationQueue.cancel(ownerId, pending.id);
  const promptIds = cancelOwnJobs(ownerId);
  setGallery(
    gallery.map((item) =>
      recordBelongsToRequest(item, req) &&
      item.status === "pending" &&
      !jobs.get(item.jobId)?.keepsPicture
        ? { ...item, status: "canceled" }
        : item,
    ),
  );
  saveGallery();
  // Only Studio's own prompts: ComfyUI's queue also holds runs from its own UI and other apps.
  await Promise.allSettled(
    promptIds.map(({ promptId, backend }) =>
      withComfyBackend(backend, () => cancelPrompt(promptId)),
    ),
  );
  res.json({ ok: true });
});

registerGalleryErrorRoutes(app);

/** Marks every Studio job still waiting or running as canceled, and returns the prompt ids ComfyUI knows them by. */
function cancelOwnJobs(ownerId = "") {
  const promptIds = [];
  for (const [id, job] of jobs) {
    if (ownerId && job.ownerId !== ownerId) continue;
    if (job.status === "queued" || job.status === "running" || job.status === "canceling") {
      if (job.promptId) promptIds.push({ promptId: job.promptId, backend: job.comfyBackend });
      // Only upscaling now: its pictures stay, and runJob delivers them once ComfyUI lets go.
      if (job.keepsPicture) {
        jobs.set(id, { ...job, status: "canceling" });
        continue;
      }
      setTerminalJob(id, { status: "canceled" });
      updateGalleryJob(id, { status: "canceled" });
    }
  }
  return promptIds;
}

registerGalleryDeleteRoute(app);

app.get("/comfy/video-preview", async (req, res) => {
  const filename = String(req.query.filename || "");
  const subfolder = String(req.query.subfolder || "");
  const type = String(req.query.type || "output");
  if (
    req.studioAccount &&
    (!ownerMediaTypes.has(type) || !outputFilenameBelongsToRequest(filename, subfolder, req))
  ) {
    res.status(404).end();
    return;
  }
  if (
    !["output", "input", "temp", mediaType].includes(type) ||
    !videoPattern.test(filename) ||
    filename !== path.basename(filename) ||
    /[\\/]/.test(filename) ||
    inDotFolder(subfolder)
  ) {
    res.status(404).end();
    return;
  }
  try {
    const cacheControl = type === mediaType ? derivedMediaCache : undefined;
    if (req.query.format === "gif") {
      res
        .type("image/gif")
        .attachment(`${path.parse(filename).name}.gif`)
        .send(await getComfyVideoGif(filename, subfolder, type));
      return;
    }
    if (req.query.format === "loop") {
      res
        .type("video/mp4")
        .attachment(`${path.parse(filename).name} loop.mp4`)
        .send(await getComfyVideoLoop(filename, subfolder, type));
      return;
    }
    // The viewer's copy (getComfyVideoPlayback); a video not kept here plays as ComfyUI has it.
    if (req.query.format === "play") {
      const playback = await getComfyVideoPlayback(filename, subfolder, type);
      if (!playback)
        res.redirect(302, `/comfy/view?${new URLSearchParams({ filename, subfolder, type })}`);
      else if (playback.original)
        res.sendFile(playback.file, { headers: { "Cache-Control": immutableMediaCache } });
      else sendVideoPreview(req, res, playback.file, cacheControl);
      return;
    }
    // The still comes from the original, ahead of any preview still being encoded.
    if (req.query.poster === "1")
      await sendVideoPoster(
        req,
        res,
        await getComfyVideoPoster(filename, subfolder, type),
        cacheControl,
      );
    else
      sendVideoPreview(
        req,
        res,
        await getComfyVideoPreview(filename, subfolder, type),
        cacheControl,
      );
  } catch {
    if (!res.headersSent) res.status(503).end();
  }
});

app.get("/comfy/thumb", async (req, res) => {
  const filename = String(req.query.filename || "");
  const subfolder = String(req.query.subfolder || "");
  const type = String(req.query.type || "output");
  if (!filename) {
    res.status(400).json({ ok: false, error: "filename is required." });
    return;
  }
  if (
    req.studioAccount &&
    (!ownerMediaTypes.has(type) || !outputFilenameBelongsToRequest(filename, subfolder, req))
  ) {
    res.status(404).json({ ok: false, error: "Not an output." });
    return;
  }
  // The same outputs /comfy/view serves, and nothing else.
  if (
    !["output", "input", "temp", mediaType].includes(type) ||
    !outputMediaPattern.test(filename) ||
    inDotFolder(req.query.subfolder)
  ) {
    res.status(404).json({ error: "Not an output." });
    return;
  }
  try {
    // A video's thumbnail is its poster, so every small view that asks for one gets a picture.
    if (videoPattern.test(filename)) {
      await sendVideoPoster(
        req,
        res,
        await getComfyVideoPoster(filename, subfolder, type),
        thumbnailCacheControl(req),
      );
      return;
    }
    // ?size=display is the viewer's larger copy (thumbnails.js RENDITIONS).
    const thumbnail = await getThumbnail(
      filename,
      subfolder,
      type,
      req.query.size === "display" ? "display" : "thumb",
    );
    if (!thumbnail) {
      res.status(404).json({ ok: false, error: "Source image is unavailable." });
      return;
    }
    // No sharp (see sharp-loader.js): the full image stands in for the thumbnail.
    if (thumbnail.original) {
      res.redirect(302, `/comfy/view?${new URLSearchParams({ filename, subfolder, type })}`);
      return;
    }
    // The ETag is a source-content hash, so revalidation safely handles a reused filename.
    res.setHeader("Cache-Control", thumbnailCacheControl(req));
    if (req.headers["if-none-match"] === thumbnail.etag) {
      res.status(304).end();
      return;
    }
    if (thumbnail.etag) res.setHeader("ETag", thumbnail.etag);
    res.type("image/webp");
    await pipeline(fs.createReadStream(thumbnail.file), res);
  } catch (error) {
    if (!res.headersSent) res.status(502).json({ ok: false, error: error.message });
    else res.destroy();
  }
});

/**
 * "Share without settings" for an output: the whole file, with the prompt and
 * workflow ComfyUI wrote into it taken out (metadata-strip.js). Buffered, since
 * the file changes; never cached, since the plain one lives at the same address.
 */
async function sendWithoutSettings(req, res) {
  const params = new URLSearchParams(
    Object.entries(req.query)
      .filter(([key]) => key !== "clean")
      .map(([key, value]) => [key, String(value)]),
  );
  let response;
  try {
    response = await fetch(`${comfyUrl}/view?${params}`, { signal: AbortSignal.timeout(120000) });
    noteComfyReachable();
  } catch (error) {
    noteComfyFetchError(error);
    res.status(502).json({ ok: false, error: "ComfyUI isn’t answering." });
    return;
  }
  if (!response.ok) {
    res.status(response.status).json({ ok: false, error: "ComfyUI doesn’t have this file." });
    return;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const type = response.headers.get("content-type") || "";
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.type(type || path.extname(String(req.query.filename || "")) || "application/octet-stream");
  res.send(stripMetadata(bytes).buffer);
}

app.get("/comfy/*path", async (req, res) => {
  try {
    const query = req.originalUrl.split("?")[1] ? `?${req.originalUrl.split("?")[1]}` : "";
    const proxyPath = Array.isArray(req.params.path) ? req.params.path.join("/") : req.params.path;
    const filename = String(req.query.filename || "");
    if (
      req.studioAccount &&
      (proxyPath !== "view" ||
        !ownerMediaTypes.has(String(req.query.type || "output")) ||
        !outputFilenameBelongsToRequest(filename, String(req.query.subfolder || ""), req))
    ) {
      res.status(404).json({ ok: false, error: "Not an output." });
      return;
    }
    // Only ComfyUI's image route, for images, videos and sound among its outputs, inputs
    // and previews. Its other GET routes (settings, logs, Manager's) are not for the studio's visitors,
    // and neither are dot folders among the outputs (such as an old `.studio-trash`).
    if (
      proxyPath !== "view" ||
      !["output", "input", "temp", mediaType].includes(String(req.query.type || "output")) ||
      !outputMediaPattern.test(String(req.query.filename || "")) ||
      inDotFolder(req.query.subfolder)
    ) {
      res.status(404).json({ ok: false, error: "Not an output." });
      return;
    }
    // Forward conditional headers so an unchanged image gets a 304 instead of a
    // full re-transfer over a slow LAN link, and stream the body instead of
    // buffering it so bytes start moving to the client as soon as they arrive.
    const conditional = {};
    for (const header of ["if-none-match", "if-modified-since", "range", "if-range"]) {
      if (req.headers[header]) conditional[header] = req.headers[header];
    }
    // Studio-owned media is served from its folder only, never forwarded to ComfyUI.
    if (String(req.query.type || "") === mediaType) {
      const file = localOutputFile(
        String(req.query.filename || ""),
        String(req.query.subfolder || ""),
        mediaType,
      );
      if (!file) {
        res.status(404).json({ ok: false, error: "This file is no longer available." });
        return;
      }
      if (req.query.clean === "1") {
        res.setHeader("Cache-Control", "private, no-store, max-age=0");
        res.type(path.extname(file) || "application/octet-stream");
        res.send(stripMetadata(fs.readFileSync(file)).buffer);
        return;
      }
      if (req.query.download === "1") res.attachment(path.basename(file));
      res.sendFile(file, { headers: { "Cache-Control": immutableMediaCache } });
      return;
    }
    if (req.query.clean === "1") {
      await sendWithoutSettings(req, res);
      return;
    }
    let response;
    try {
      response = await fetch(`${comfyUrl}/${proxyPath}${query}`, { headers: conditional });
      noteComfyReachable();
    } catch (error) {
      noteComfyFetchError(error);
      throw error;
    }
    res.status(response.status);
    const etag = response.headers.get("etag");
    const lastModified = response.headers.get("last-modified");
    const contentLength = response.headers.get("content-length");
    if (etag) res.setHeader("ETag", etag);
    if (lastModified) res.setHeader("Last-Modified", lastModified);
    if (contentLength) res.setHeader("Content-Length", contentLength);
    for (const header of ["accept-ranges", "content-range", "content-disposition"]) {
      const value = response.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    if (response.status === 304 || !response.body) {
      res.end();
      return;
    }
    res.type(response.headers.get("content-type") || "application/octet-stream");
    await pipeline(Readable.fromWeb(response.body), res);
  } catch (error) {
    if (!res.headersSent) res.status(502).json({ ok: false, error: error.message });
    else res.destroy();
  }
});

const dist = path.join(root, "dist");
// An unknown API route must fail as JSON, never fall through to the app page.
app.all("/api/*splat", (_req, res) =>
  res
    .status(404)
    .json({ ok: false, error: "Unknown API route. If Studio was updated, restart it." }),
);

if (fs.existsSync(dist)) serveApp(app, dist);

setTimeout(
  () =>
    recoverGalleryFromHistory()
      .catch(() => null)
      // Videos imported before their size was read get it now.
      .then(() => fillVideoSizes())
      .catch(() => null),
  1200,
);
// Studio media's thumbnails and posters are built ahead of their first view.
startMediaWarmup();

// dev.mjs hands the server the Vite proxy's token; Vite serves the page there.
const dev = Boolean(process.env.STUDIO_DEV_PROXY_TOKEN);
// A reverse proxy pools idle upstream connections (Traefik for 90 seconds) and sends the next
// request on one without checking it. Node closes idle sockets after 5 seconds by default, so a
// POST after a short pause raced that close and the proxy answered 502 (Go retries only GETs).
const server = http.createServer(app);
server.keepAliveTimeout = 120_000;
server.headersTimeout = 121_000;
server.once("error", (error) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `\n  Port ${port} is already in use. Stop what uses it, or set another PORT.\n`
      : `\n  Studio couldn’t start: ${error.message}\n`,
  );
  process.exit(1);
});
server.listen(Number(port), host, () => {
  const listening = server.address().port;
  // Phone links in Settings use the bound address.
  setListeningPort(listening);
  // localhost rather than 127.0.0.1: same server, but browsers only allow passkeys
  // on a name, never on an address.
  const shownHost =
    host === "0.0.0.0" || host === "::" || host === "127.0.0.1" ? "localhost" : host;
  const pagePort = dev ? 5173 : listening;
  console.log(
    `Studio ${appVersion || "development"}\nOpen http://${shownHost.includes(":") ? `[${shownHost}]` : shownHost}:${pagePort}`,
  );
  void (async () => {
    // Listening beyond this computer: say where a phone can open it.
    if (multiUserEnabled && networkListening && (host === "0.0.0.0" || host === "::")) {
      const addresses = Object.values(os.networkInterfaces())
        .flatMap((entries) => entries || [])
        .filter((entry) => entry.family === "IPv4" && !entry.internal)
        .map((entry) => `http://${entry.address}:${pagePort}`);
      for (const address of addresses) console.log(`    ➜  Network   ${address}`);
    }
    // No workers is a setup of its own: say so.
    if (!listWorkers().length) {
      if (!demoMode)
        console.log(
          "    No workers are set up yet. Set STUDIO_WORKERS or STUDIO_KUBERNETES_NAMESPACES.\n",
        );
      return;
    }
    // Starting before ComfyUI is fine, but say so instead of leaving people to guess.
    const answering = await fetch(`${comfyUrl}/system_stats`, {
      signal: AbortSignal.timeout(3000),
    }).then(
      (response) => response.ok,
      () => false,
    );
    if (!answering && !demoMode)
      console.log(
        `    ComfyUI isn’t answering at ${comfyUrl} yet. The studio connects once it starts.\n`,
      );
  })().catch(() => {});
  // Tells a parent process (the server tests) where this one listens.
  process.send?.({ type: "ready", version: appVersion, url: `http://${shownHost}:${pagePort}` });
});

drainServer = async () => {
  // MCP calls waiting inline for images reply with their links instead of outliving the grace.
  mcp?.endWaits();
  const closed = new Promise((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await Promise.all([generationQueue.stop(), closed]);
  await flushGalleryStrict();
  store.close();
};
