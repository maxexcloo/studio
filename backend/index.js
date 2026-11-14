// First: the settings (.env), so every module below reads them.
import "./env.js";
// Then: refuses to start on data migrate-runtime has not brought current.
import "./storage-check.js";
import { createJobRecovery } from "./job-recovery.js";
import { installShutdown } from "./shutdown.js";
import { listenForAgentSignIn } from "./agent-sign-in.js";
import {
  registerGalleryReadRoutes,
  registerGalleryHistoryRoutes,
  registerGalleryErrorRoutes,
  registerGalleryDeleteRoute,
} from "./gallery/routes.js";
import { createGenerationSubmission } from "./generation-routes.js";
import { createGenerationAdmission } from "./domain/admission.ts";
import { registerCompareRoutes } from "./domain/compare.ts";
import { createDream } from "./domain/dream.ts";
import { registerDreamRoutes } from "./domain/dream-routes.ts";
import { createProjects, stylesWithChoice } from "./domain/projects.ts";
import { createFinishing, registerFinishingRoutes } from "./domain/finishing.ts";
import { fullBodyPerson } from "./mcp/prompt-checks.js";
import {
  createNextStepWork,
  createSuggestions,
  registerSuggestionRoutes,
} from "./domain/suggestions.ts";
import {
  createTaste,
  itemValues,
  preferenceSignal,
  setPreferenceSignals,
  registerTasteRoutes,
  tasteSignal,
} from "./domain/taste.ts";
import { queuePriority, Store } from "./domain/store.ts";
import { createCaptioner } from "./domain/captions.ts";
import { createReview } from "./domain/review.ts";
import { createImageSearch, createImageVectors } from "./domain/image-search.ts";
import { registerIdlePassRoutes } from "./domain/idle-work.ts";
import { createTitler } from "./domain/titles.ts";
import { createPromptSuggester } from "./domain/suggested-prompts.ts";
import {
  readRuntimeDocument,
  runtimeDatabase,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";
import { configuredCliProxy } from "./providers/cliproxy.ts";
import { createSiglip, siglipVersion } from "./providers/siglip.ts";
import { createFaces } from "./providers/faces.ts";
import { createFaceCheck } from "./domain/face-check.ts";
import { createFaceRedo } from "./domain/face-redo.ts";
import { composeWorkflowPrompt } from "./graphs.js";
import { studioCloudProfiles } from "./providers/profiles.ts";
import { workerLoads } from "./queue-eta.js";
import { registerMaintenanceRoutes, registerRewriteRoutes } from "./domain/routes.ts";
import { registerMigrationRoutes } from "./runtime-migrations.js";
import { loadRuntime, registerRuntimeStatus } from "./runtime/bootstrap.ts";
import { createSwapRouter } from "./runtime/routes.ts";
import { createLocalText, createServicesObserver, parkedWorkers } from "./runtime/services.ts";
import { registerModelDownloadRoutes } from "./model/download-routes.js";
import { createModelCatalogue, modelsForAccount } from "./model/catalogue.js";
import { registerModelRoutes } from "./model/routes.js";
import { registerStatusRoutes } from "./status-routes.js";
import { createAssistantContext } from "./assistant-context.js";
import { modelFileReferences, profileDefinitions } from "./library/file-users.js";
import { draftCheckpointProfile } from "./profile/import-draft.js";
import { createGenerationQueue } from "./generation-queue.js";
import { createMcpDomainRequest, resolveSignedMcpResult } from "./mcp/studio-requests.js";
import { registerUpscaleRoutes } from "./upscale-routes.js";
import { registerJobRoutes } from "./job-routes.js";
import { registerComfyMediaRoutes } from "./comfy/media-routes.js";
import { registerPreferenceRoutes } from "./preference-routes.js";
import { registerPromptHistoryRoutes } from "./prompt-history-routes.js";
import { registerDeploymentRoutes } from "./deployment-routes.js";
import { registerLoraRoutes } from "./lora/routes.js";
import { registerWorkflowRoutes } from "./workflow-routes.js";
import { registerPresetRoutes } from "./preset-routes.js";
import { registerLibraryRoutes } from "./library/routes.js";
import { importStore } from "./library/imports.js";
import { registerProfileEditorRoutes, repointProfiles } from "./profile/editor.js";
import { registerProfileRoutes } from "./profile/routes.js";
import { seedSamples } from "./profile/seed.js";
import { promptAssistantOff, registerAssistantRoutes } from "./assistant-routes.js";
import { createPromptStage } from "./prompt-stage.js";
import {
  canonicalProfileId,
  guideStore,
  profileStore,
  withCanonicalProfile,
} from "./profile/store.js";

import { adminRefusal, requireAdmin } from "./route-access.js";
import express from "express";
import { configuredBackends, routeJob, setParkedCheck } from "./comfy/backends.js";
import { defaultWorker, defaultWorkerId, listWorkers, useWorkloadWorkers } from "./workers.js";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  networkListening,
  comfy,
  comfyFile,
  comfyOn,
  host,
  optionsFor,
  port,
  root,
  setListeningPort,
} from "./comfy/comfy.js";
import { canAdmin, clientOf } from "./access.js";
import { hostAllowed, requestGuard } from "./request-guard.js";
import { registerMcpRoutes } from "./mcp/mcp.js";
import { loadSharp } from "./sharp-loader.js";
import { appVersion } from "./data-dir.js";
import { buildProfile, offlineModelResult } from "./model/models.js";
import { flagEnabled } from "./deployment-settings.js";
import { hfFetch } from "./hf-access.js";
import { flushWorkflowPreferences } from "./workflow-catalogue.js";
import {
  deleteOwnedGalleryItems,
  filterVisibleGallery,
  hasGalleryMedia,
  isGalleryHidden,
  eachGalleryItem,
  galleryItem,
  galleryItems,
  galleryChangeCount,
  galleryJobItems,
  hasGalleryItems,
  forgetGalleryItems,
  putGalleryItems,
  visibleGallery,
  dataDir,
  importedImageFile,
  outputFileSize,
  recordsFromComfyHistory,
  removeGalleryItems,
  resultNumbers,
  cleanupGalleryState,
  updateGalleryJob,
  galleryRevisionValue,
  onGalleryFilesDeleted,
  setGalleryFavorites,
} from "./gallery/store.js";
import { makePendingItems } from "./gallery/records.js";
import { compareGalleryItems } from "./gallery/order.js";
import { registerResultSetRoutes, setPrompts } from "./result-sets.js";
import { galleryKey } from "./persistence/gallery-rows.ts";
import { fillVideoSizes } from "./library/library.js";
import { startMediaWarmup } from "./media-warmup.js";
import { jobs, setTerminalJob } from "./jobs.js";
import { cancelPrompt } from "./comfy/queue.js";
import { catalogueLoraInfo, familiesFromMetadata, loraCatalogue, loraInfos } from "./lora/info.js";
import { optionalLoraPolicyIssue } from "./lora/catalogue.js";
import { strengthRange } from "./lora/policy.js";
import { getCustomWorkflow, loadCustomWorkflows, userWorkflowsDir } from "./custom-workflows.js";
import { registerReferenceRoutes } from "./reference-routes.js";
import { createCard, listCards, refusal as cardRefusal, registerCardRoutes } from "./cards.js";
import { createCharacterSheets } from "./character-sheets.js";
import { registerVideoEditRoutes } from "./gallery/video-edits.js";
import { registerRecreateRoute } from "./gallery/recreate.js";
import { registerGalleryImportRoute } from "./gallery/import.js";
import { registerRedditImportRoute } from "./gallery/reddit.js";

import { loadLoraLibrary } from "./lora/stacks.js";
import {
  animatedPhoto,
  bytesForReferenceAccount,
  galleryStill,
  referenceAssetForAccount,
} from "./references.js";
import { compressJson, serveApp } from "./http-assets.js";
import { isMediaUrl, mediaFile, mediaParams } from "./media-paths.js";
import { gatedPath } from "./gated-path.js";
import { ingestRecords, noteIngested, removeComfyFiles } from "./media-store.js";
import { forgetComfyRun } from "./comfy/traces.js";
import {
  accountForRequest,
  multiUserEnabled,
  registerMultiUserAuthRoutes,
} from "./multi-user-auth.js";
import { enforceMultiUserRequest } from "./multi-user-gate.js";
import { ownerIdForRequest, recordsForRequest } from "./account-ownership.js";
import {
  accountRoles,
  explicitWording,
  mayUseFeature,
  mayUseGenerationProfile,
  promptWriter,
} from "./account-policy.js";
import { accountPreferences } from "./account-preferences.js";
import { dreamVideoProfile } from "./animate-profile.js";
import { minorAge } from "./minor-age.js";
import {
  accountAccessForId,
  gatewayAccountAccess,
  gatewayAdminTools,
  listAccounts,
  noteGatewayIdentity,
  verifyAccountMcpToken,
} from "./account-store.js";
import { characterImageIds } from "../shared/characters.ts";
import { isCloudProfile } from "../shared/profiles.ts";

let drainServer = async () => {};
installShutdown({ drain: () => drainServer() });

const app = express();
// Routes match exactly as written. Express otherwise matches /API/… to /api/… while every gate
// checks the lowercase prefix, so a capitalised path would reach handlers ungated.
app.set("case sensitive routing", true);
// Before anything reads a body: other websites and rebound hostnames stop here (request-guard.js).
app.use(requestGuard({ network: networkListening }));
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
      `[Studio] The ${name} store couldn't take in the older files yet: ${error.message}`,
    );
  }
}
// GPU deployments Studio scales (runtime/bootstrap.ts); the control MCP tools and Settings › Workers drive it.
const runtime = await loadRuntime(process.env, { dataDir });
if (runtime) {
  useWorkloadWorkers(runtime.controller.workloads);
  setParkedCheck(async (id) => (await parkedWorkers(runtime.controller, listWorkers())).has(id));
}
// The local text route while a local text workload runs; without a runtime, text takes the cloud route.
const localText = runtime ? createLocalText({ controller: runtime.controller }) : undefined;
const mcp = registerMcpRoutes(app, {
  dataDir,
  runtime: runtime?.controller,
  workerStatus: async () =>
    (
      await observeServices({
        allowed: [],
        administrator: true,
        loads: workerLoads(generationQueue),
      })
    ).workers,
  gatewayAdminTools,
  baseUrl: () => `http://127.0.0.1:${port}`,
  allowedHost: (req) => hostAllowed(req.headers.host, { network: networkListening }),
  accountMode: multiUserEnabled,
  authenticateAccountToken: verifyAccountMcpToken,
  authenticateGatewayIdentity: gatewayAccountAccess,
  noteGatewayIdentity,
  resolveSignedResult: resolveSignedMcpResult,
  domainRequest: (...args) => mcpDomainRequest(...args),
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
  latestComfyContext,
  loadComfyContext,
  mediaModels,
  presetModels,
  unavailableModels,
} = catalogue;

const recoverRunningJobs = createJobRecovery({
  backends: configuredBackends,
  finishJob: (id, patch) => {
    setTerminalJob(id, patch);
  },
  gallery: {
    tiles: () =>
      galleryItems({ status: ["pending", "failed", "cancelled"] }).filter((item) => !item.url),
    job: (id) => galleryItems({ jobId: id }),
    save: putGalleryItems,
    replace: (id, outputs) => {
      forgetGalleryItems(galleryItems({ jobId: id }).filter((item) => !item.url));
      putGalleryItems(
        outputs.filter((item) => !hasGalleryItems({ named: [item.url], status: "done" })),
      );
    },
  },
  jobs,
  recordsFromHistory: recordsFromComfyHistory,
  request: comfy,
  // Dream's pool included: an orphaned Dream job otherwise runs forever, holding its worker.
  visible: (items) => items.filter(hasGalleryMedia),
  cancel: (backend, promptId) => cancelPrompt(promptId, comfyOn(backend)),
  ingest: (backend, records, promptId) =>
    ingestRecoveredRecords(backend, records, promptId ? [promptId] : []),
});

/**
 * Recovered ComfyUI outputs move into Studio media and
 * leave ComfyUI. ComfyUI's copies go only after the caller has put the records
 * in the gallery and it is on disk.
 */
async function ingestRecoveredRecords(backend, records, promptIds = []) {
  if (!records.length) return records;
  const moved = await ingestRecords(backend, records);
  // A history record carries the size asked for; the saved file's own size is what the run drew.
  moved.records = await Promise.all(
    moved.records.map(async (record) => {
      const params = mediaParams(record.url);
      const file = params && mediaFile(params.filename, params.subfolder);
      const size = file ? await outputFileSize(file, record.type) : null;
      return size?.width ? { ...record, width: size.width, height: size.height } : record;
    }),
  );
  if (moved.comfyFiles.length) {
    const ids = [
      ...new Set([...promptIds, ...records.map((item) => item.promptId).filter(Boolean)]),
    ];
    setTimeout(
      () =>
        (async () => {
          // Nothing that did not make it into the gallery loses its ComfyUI copy.
          if (
            !moved.records.every(
              (record) =>
                !record.url || !isMediaUrl(record.url) || hasGalleryItems({ named: [record.url] }),
            )
          )
            return;
          noteIngested(records.map((item) => item.jobId));
          await removeComfyFiles(backend, moved.comfyFiles);
          if (ids.length) await forgetComfyRun(backend, { promptIds: ids }).catch(() => false);
        })().catch(() => null),
      0,
    );
  }
  return moved.records;
}
setInterval(() => recoverRunningJobs(), 5000).unref();

async function recoverGalleryFromHistory() {
  // Recovery follows only jobs already recorded in this runtime's gallery.
  await recoverRunningJobs();
  cleanupGalleryState(store);
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
const runtimeRequester = (req) =>
  req.studioAccount?.userId ? `account:${req.studioAccount.userId}` : "local";
registerRuntimeStatus(
  app,
  runtime,
  (req, res, next) => {
    if (requireAdmin(req, res)) next();
  },
  runtimeRequester,
);
const observeServices = createServicesObserver({
  workers: listWorkers,
  controller: runtime?.controller,
});
// Grantable profiles come from the same discovery as /api/models, across image and video backends.
// Cloud profiles are granted by the Cloud Models feature, so they are listed apart. Their IDs don't
// wait on a worker's node list, which takes seconds after a restart.
const discoveredProfiles = async () => {
  const models = await mediaModels(false, { wait: false })
    .then((result) => result.models)
    .catch(() => offlineModelResult(defaultWorker()?.url));
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

registerModelRoutes(app, { catalogue });

registerModelDownloadRoutes(app, { loadComfyContext });
const presetRoutes = registerPresetRoutes(app, { models: presetModels });
// The Library (library/routes.js): imports, their records and grades, and what is installed with its provenance.
const unique = (...lists) => [
  ...new Set(lists.flat().filter((name) => typeof name === "string" && name)),
];
/** The model files a ComfyUI node list offers, by folder. */
const installedFiles = (info) => ({
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
});
registerLibraryRoutes(app, {
  presets: presetRoutes,
  catalogue: loraCatalogue,
  draftProfile: (record, options) =>
    draftCheckpointProfile(record, options, {
      engine: assistantEngine,
      info: () => profileObjectInfo("image"),
    }),
  families: (baseModel) => familiesFromMetadata({ base_model: String(baseModel || "") }),
  loraInfo: (names, options) => loraInfos(defaultWorkerId(), names, options),
  installed: async () => installedFiles((await loadComfyContext(defaultWorkerId())).info),
  // The Library's list: the worker's last known files at once, refreshed in the background.
  latestInstalled: async () => {
    const { info, current } = await latestComfyContext(defaultWorkerId());
    return { files: installedFiles(info), current };
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
  gguf: async () => Boolean((await loadComfyContext(defaultWorkerId())).info?.UnetLoaderGGUF),
  // The assistant registers below; the Library asks for it only when describing an image.
  assistant: () => assistantEngine,
  repoint: async (from, to) => repointProfiles(from.file, to.file),
  references: (model) => modelFileReferences(model, presetModels),
  recentLoras: () => {
    const since = Date.now() - 90 * 86_400_000;
    return new Set(
      galleryItems({ since })
        .filter((item) => Date.parse(item.createdAt || "") >= since)
        .flatMap((item) => (item.settings?.loras || []).map((lora) => lora.name)),
    );
  },
  profileDefinitions,
});

registerWorkflowRoutes(app, { loadComfyContext });

const profileObjectInfo = async (kind) =>
  (await loadComfyContext(routeJob(kind === "video" ? "video" : "image")?.id || defaultWorkerId()))
    .info;
registerProfileEditorRoutes(app, {
  objectInfo: profileObjectInfo,
  accountName: (account) => account?.userId || "",
});
// Library › Profiles: versions, revert, approve, guides and the export bundle (profile/routes.js).
registerProfileRoutes(app, {
  profiles: () => profileStore(),
  guides: () => guideStore(),
  objectInfo: profileObjectInfo,
  accountName: (account) => account?.userId || "",
  exportOptions: () => ({
    dataDir,
    workflowsDir: userWorkflowsDir,
    manifestFile: loraCatalogue().manifestFile?.() || "",
    studioVersion: appVersion,
  }),
});

// The prompt assistant (assistant-routes.js): account-scoped, behind the Prompt Assistant feature,
// reading what an account may use (assistant-context.js).
const assistant = createAssistantContext({ catalogueModels, loadComfyContext });
// The gateway lists only running models; stopped text workloads' models are choices too.
const workloadModels = () =>
  (runtime?.controller.workloads || [])
    .filter((item) => item.kind === "text" && item.model)
    .map((item) => item.model);
const assistantEngine = registerAssistantRoutes(app, {
  localText,
  workloadModels,
  frame: (req, id) => assistant.image(req.studioAccount, id),
  caption: (req, id) => assistant.caption(req.studioAccount, id),
  profiles: assistant.profiles,
  guide: assistant.guide,
  loras: assistant.loras,
  starred: assistant.starred,
});

const readComparisons = () => {
  try {
    return readRuntimeDocument(dataDir, "comparisons");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
};
registerGalleryReadRoutes(app, {
  store,
  compared: (ownerId) => {
    const records = readComparisons().filter((record) => record.ownerId === ownerId);
    // Compare Selected names its images; other comparisons hold their jobs' results.
    const items = new Set(records.flatMap((record) => record.itemIds || []));
    const jobs = new Set(records.flatMap((record) => (record.itemIds ? [] : record.jobIds)));
    return (item) => items.has(item.id) || jobs.has(item.jobId);
  },
  near: (text) => imageSearch.near(text),
  similar: (item) => imageSearch.similar(item),
});

registerLoraRoutes(app, { comfyDownMessage, loadComfyContext });

// Taste profiles (domain/taste.ts) learn from stars, compare votes and iterations on a result.
// A gone or disabled account's prompts never reach the text model.
const tasteWriter = (ownerId) =>
  ownerId && !accountAccessForId(ownerId)?.authenticated ? null : assistantEngine;
// Text takes the cloud route whenever no local text worker runs (assistant.js), so a configured
// gateway is always reachable; a stopped or parked local worker never makes text unavailable.
const textOnline = async () => Boolean(assistantEngine);
const tasteStore = createTaste({
  dataDir,
  writer: tasteWriter,
  online: textOnline,
  updates: () => flagEnabled("STUDIO_TASTE_UPDATES"),
});
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
/** Hears which of an account's items were starred or unstarred, by hand or by animating a photo. */
const itemsStarred = (ownerId, items, favorite) => {
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
  taste.record(ownerId, [
    ...items.map((item) => tasteSignal(favorite ? "star" : "unstar", item.jobId, itemValues(item))),
    ...(favorite
      ? setPreferenceSignals(
          items,
          items.flatMap((item) =>
            item.resultSet?.id ? galleryItems({ setId: item.resultSet.id }) : [],
          ),
          itemValues,
        )
      : []),
  ]);
};
// Every admitted job teaches the taste profile (iterations, chat reruns included) and makes a waiting finishing upscale step aside.
// Animating one of the account's photos, from the app or MCP, stars that photo.
const jobAdmitted = (job) => {
  if (job.parentJobId || job.parentItemId)
    taste.record(job.ownerId, [tasteSignal("iterate", job.id, job.input)]);
  const photo = animatedPhoto(job);
  if (photo) itemsStarred(job.ownerId, setGalleryFavorites([photo.id], true), true);
  finishing.admitted(job);
  captioner.interrupt();
  dreamReview.interrupt();
  imageSearch.interrupt();
  titler.interrupt();
  suggester.interrupt();
  nextSteps.interrupt();
};
registerGalleryHistoryRoutes(app, {
  starred: (req, items, favorite) => itemsStarred(ownerIdForRequest(req), items, favorite),
});

registerPreferenceRoutes(app);
registerPromptHistoryRoutes(app);

// An upload is searchable at once, like a finished generation.
registerReferenceRoutes(app, { uploaded: (item) => void imageSearch.completed([item]) });
registerCardRoutes(app);
registerVideoEditRoutes(app, { store });
registerRecreateRoute(app, { store });
registerGalleryImportRoute(app, { uploaded: (item) => void imageSearch.completed([item]) });
registerRedditImportRoute(app, { uploaded: (item) => void imageSearch.completed([item]) });

registerDeploymentRoutes(app, { assistantEngine, mediaModels, unavailableModels });

const generationRoutes = createGenerationSubmission({
  loadComfyContext,
  mediaModels,
  comfyDownMessage,
});

// The queue's writing stage (prompt-stage.js): prompts the assistant writes for a generation.
const promptStage = createPromptStage({
  engine: assistantEngine,
  account: (ownerId) => {
    const account = ownerId ? accountAccessForId(ownerId) : undefined;
    return ownerId && !account?.authenticated ? null : account;
  },
  profiles: (account) => assistant.profiles({ studioAccount: account }),
  guide: assistant.guide,
  dream: () => dream,
  frame: assistant.image,
  caption: assistant.caption,
  setPrompts: (job) => setPrompts(store, job),
});
// The generation queue (generation-queue.js): local workers, the direct cloud and upscales.
const { generationQueue, queueResourceFor, validateGenerationInput, waitingWorkloads } =
  createGenerationQueue({
    assistantEngine,
    catalogue,
    cloudProvider,
    completed: (items) => {
      void titler.completed(items);
      void imageSearch.completed(items);
      void faceCheck.completed(items);
      void characterSheets.completed(items);
      if (items.some((item) => item.dream)) dream.finished();
    },
    directCloud,
    generationRoutes,
    promptStage,
    recoverRunningJobs,
    runtime,
    store,
  });
if (runtime)
  app.use(
    createSwapRouter(runtime.controller, {
      admin: (req) => !req.studioAccount || canAdmin(req),
      workloads: (req, id) => waitingWorkloads(ownerIdForRequest(req), id),
      requestedBy: runtimeRequester,
    }),
  );
registerStatusRoutes(app, { observeServices, queue: generationQueue });
const admitGeneration = createGenerationAdmission({
  store,
  queue: generationQueue,
  resourceFor: queueResourceFor,
  // Numbered as queued, so a chat names a result before it starts.
  pendingItems: (id, input) => resultNumbers.numbered(makePendingItems(id, input)),
  revision: galleryRevisionValue,
  validate: validateGenerationInput,
  separateRuns: (input) => {
    const workflow = getCustomWorkflow(input.profileId, input.profileBackend);
    return input.kind === "image" && Boolean(workflow) && !workflow.controls?.count;
  },
  admitted: jobAdmitted,
});
// Make Sheet (character-sheets.js): a character's design sheet, cut into its views once made.
const characterSheets = createCharacterSheets({
  admit: admitGeneration,
  profiles: (account) => assistant.profiles({ studioAccount: account }),
});
characterSheets.register(app);
app.post("/api/generate", async (req, res) => {
  const result = await admitGeneration(req.body || {}, req.studioAccount);
  res.status(result.status).json(result.payload);
});
registerRewriteRoutes(app, {
  store,
  queue: generationQueue,
  admit: admitGeneration,
  // Next steps are asked for in the viewer (`/api/suggestions`), not carried in every queue poll.
  media: (ownerId, jobId) =>
    galleryJobItems(jobId)
      .filter((item) => (item.ownerId || "") === ownerId && !isGalleryHidden(item))
      .map(({ nextSteps: _steps, ...item }) => item),
  ownsItem: (ownerId, id) => {
    const item = galleryItem(id);
    return Boolean(item && (item.ownerId || "") === ownerId && !isGalleryHidden(item));
  },
});
registerMaintenanceRoutes(app, { store, queue: generationQueue, adminRefusal });
registerResultSetRoutes(app, {
  store,
  admit: admitGeneration,
  item: (ownerId, id) => {
    const item = galleryItem(id);
    return item && (item.ownerId || "") === ownerId && !isGalleryHidden(item) ? item : undefined;
  },
});
registerMigrationRoutes(app, {
  dataDir,
  adminRefusal,
  // missingComfyOutputs asks the worker that made a record for its file, as publicGalleryBuffer reads it.
  gallery: {
    items: () => galleryItems(),
    check: (item) => comfyFile(item.url, { method: "HEAD", timeout: 15_000 }),
    remove: removeGalleryItems,
    update: (jobId, patch) => updateGalleryJob(jobId, patch),
  },
});
registerCompareRoutes(app, {
  store,
  admit: admitGeneration,
  cancel: (ownerId, jobId) => generationQueue.cancel(ownerId, jobId),
  read: readComparisons,
  write: (records) => writeRuntimeDocument(dataDir, "comparisons", records),
  gallery: (req, { jobIds = [], itemIds = [] }) =>
    recordsForRequest(
      visibleGallery({ jobIds }).concat(
        visibleGallery({ ids: itemIds }).filter((item) => !jobIds.includes(item.jobId)),
      ),
      req,
    ),
  pendingItems: makePendingItems,
  numbered: (items) => resultNumbers.numbered(items),
  voted: (ownerId, image, others) => {
    const winner = { jobId: image.jobId, values: itemValues(image) };
    taste.record(ownerId, [
      tasteSignal("compare", image.jobId, winner.values),
      ...others.map((item) =>
        preferenceSignal(winner, { jobId: item.jobId, values: itemValues(item) }),
      ),
    ]);
  },
  // Undo on the Dream page (or the vote's notification) restores the brief it replaced.
  picked: ({ ownerId, projectId, axis }, choice, by) => {
    const project = projects.list(ownerId).find((entry) => entry.id === projectId);
    if (!project) return null;
    const styles = stylesWithChoice(project.brief.styles, axis, choice);
    if (styles === project.brief.styles) return null;
    projects.update(ownerId, project.id, { brief: { styles } }, by);
    return { projectId: project.id, name: project.name, styles };
  },
});
registerTasteRoutes(app, { taste });
/** Whether admitted local text work is running now; Dream and captions wait for it. */
const textBusy = () =>
  Boolean(
    runtime?.controller
      .status()
      .some((workload) => workload.kind === "text" && workload.acceptedOperations > 0),
  );
/** Whether what the owner is offered may be worded explicitly. */
// Dream reads an account's gallery many times a tick: one copy serves them until the gallery
// changes, and is let go once Dream stops asking.
let dreamCopy = { key: "", items: [], timer: null };
function dreamGallery(ownerId) {
  const key = `${ownerId}|${galleryChangeCount()}`;
  if (dreamCopy.key !== key)
    dreamCopy = {
      key,
      items: galleryItems({ ownerId }, { ordered: false })
        .sort(compareGalleryItems)
        .map(withCanonicalProfile),
      timer: null,
    };
  clearTimeout(dreamCopy.timer);
  dreamCopy.timer = setTimeout(() => (dreamCopy = { key: "", items: [], timer: null }), 30_000);
  dreamCopy.timer.unref();
  return dreamCopy.items;
}
const explicitFor = (ownerId) =>
  explicitWording(ownerId ? accountAccessForId(ownerId) : undefined, accountPreferences(ownerId));
// Suggestions (domain/suggestions.ts): composer ideas and viewer next steps from taste.
const suggestions = createSuggestions({
  taste,
  writer: tasteWriter,
  online: textOnline,
  explicit: explicitFor,
  item: (ownerId, jobId) => filterVisibleGallery(galleryJobItems(jobId, ownerId))[0],
  image: async (item) => ((await assistantEngine?.supportsVision()) ? smallImage(item) : null),
  // The viewer asks by job, so every result of the run keeps the same steps.
  save: (item, nextSteps) => updateGalleryJob(item.jobId, { nextSteps }),
  ideas: () => flagEnabled("STUDIO_PROMPT_IDEAS"),
  nextSteps: () => flagEnabled("STUDIO_NEXT_STEPS"),
  target: (ownerId, item) =>
    assistant.target(
      ownerId ? accountAccessForId(ownerId) : undefined,
      item.settings?.profileId || "",
    ),
  promptWriter: (ownerId) =>
    promptWriter(ownerId ? accountAccessForId(ownerId) : undefined, accountPreferences(ownerId)),
});
registerSuggestionRoutes(app, {
  suggestions,
  refusal: (req) =>
    req.studioAccount && !mayUseFeature(req.studioAccount, "promptAssistant")
      ? promptAssistantOff
      : "",
});
// Dream (domain/dream.ts): idle-time results from the taste profile, off until an account turns it on.
// It only queues work; it never places GPU workloads, and cloud profiles never take part.
const projects = createProjects({ dataDir });
const dream = createDream({
  dataDir,
  store,
  taste,
  projects: (ownerId) => projects.list(ownerId),
  chats: (ownerId) => projects.chats(ownerId),
  owners: () => (multiUserEnabled ? listAccounts().map((account) => account.id) : [""]),
  // A group's Dream feature gates its routes and idle work alike.
  access: (ownerId) => {
    const account = ownerId ? accountAccessForId(ownerId) : undefined;
    if (ownerId && !mayUseFeature(account, "dream")) return null;
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
  // One Dream job per image worker, so idle GPUs all take part; background work routes to the free one.
  slots: () =>
    Math.max(1, listWorkers().filter((worker) => worker.capabilities.includes("image")).length),
  writer: assistantEngine,
  guide: assistant.guide,
  gallery: dreamGallery,
  items: (ownerId, ids) => galleryItems({ ownerId, ids }).map(withCanonicalProfile),
  visible: filterVisibleGallery,
  // Only the owner's own record: updateGalleryJob alone matches any account's item.
  mark: (ownerId, itemId, mark) => {
    if (!galleryItem(itemId, ownerId)) throw new Error("That Dream result is unavailable.");
    updateGalleryJob(itemId, { dream: mark });
  },
  remove: (ownerId, itemIds) => deleteOwnedGalleryItems(ownerId, itemIds),
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
  // Library imports and their Inspiration are administration, shared across Studio, so only an
  // administrator's Dream, or single-user mode's, draws on them. A saved Civitai image is listed
  // once, by its gallery copy; files that are not installed drop out where Dream fits the LoRAs to
  // the profile.
  inspiration: (account) => {
    if (account && account.role !== accountRoles.administrator) return [];
    const saved = visibleGallery({ idPrefix: "civitai:" })
      .filter((item) => item.civitai && importedImageFile(item) && item.type !== "video")
      .map((item) => ({
        prompt: item.prompt || "",
        profileId: item.settings?.profileId || "",
        loras: item.settings?.loras || [],
      }));
    const imported = importStore()
      .list()
      .filter(
        (record) =>
          ["ready", "needs-files"].includes(record.state) && record.input?.kind !== "civitai-image",
      )
      .map((record) => ({
        prompt: record.preset?.prompt || "",
        profileId:
          record.resources?.find(
            (resource) =>
              ["checkpoint", "diffusion_model"].includes(resource.role) &&
              ["installed", "substitute"].includes(resource.status),
          )?.profileId ||
          record.suggestion?.profileId ||
          "",
        loras: (record.resources || [])
          .filter((resource) => resource.role === "lora" && resource.status === "installed")
          .map((resource) => ({
            name: resource.localName || resource.want?.file || "",
            strength: resource.strength ?? 1,
          })),
      }));
    return [...saved, ...imported].filter((item) => item.prompt.trim());
  },
  reference: (account, itemId, frame) =>
    referenceAssetForAccount(account, itemId, frame ? { frame } : undefined),
  videoProfile: async (ownerId, account, { width, height, extend }) => {
    const models = modelsForAccount((await mediaModels(false)).models, { studioAccount: account });
    return dreamVideoProfile(models.profiles || [], {
      videos: accountPreferences(ownerId).videos,
      extend: extend && canonicalProfileId(extend),
      defaultId: models.defaults?.videoModel,
      localRunning: models.backends?.video?.available !== false,
      localParked: models.backends?.video?.parked === true,
      width,
      height,
    });
  },
  cards: (ownerId) => {
    if (cardRefusal(ownerId ? accountAccessForId(ownerId) : undefined)) return null;
    return Object.fromEntries(
      ["characters", "outfits", "scenes"].map((kind) => [kind, listCards(kind, ownerId)]),
    );
  },
  createCard,
  minorAge,
  admit: admitGeneration,
  cancel: (ownerId, jobId) => generationQueue.cancel(ownerId, jobId),
});
registerDreamRoutes(app, {
  dream,
  projects,
  numbered: (items) => resultNumbers.numbered(items),
});
// Idle for background work: no live job but Dream's and no text work. Dream yields to all of it,
// so review, captions and finishing don't wait for Dream to reach its caps.
const studioIdle = () =>
  !textBusy() && !store.openJobs().some((job) => job.priority !== queuePriority.dream);
// Gallery work (captions, image search, titles, suggested prompts, next steps) may run while busy.
const galleryIdle = () => flagEnabled("STUDIO_GALLERY_WHILE_BUSY") || studioIdle();
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
  item: (ownerId, itemId) => galleryItem(itemId, ownerId),
  idle: studioIdle,
  ready: (quality) => upscale.upscaleReady(quality),
  fullBody: fullBodyPerson,
  upscale: (ownerId, request) =>
    upscale.queueUpscale(ownerId ? accountAccessForId(ownerId) : undefined, request, {
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
// Prompts and next steps written for the owner also need its group's Prompt Assistant feature.
function promptWriterOwner(ownerId) {
  if (!multiUserEnabled) return true;
  return Boolean(ownerId && mayUseFeature(accountAccessForId(ownerId), "promptAssistant"));
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
  idle: galleryIdle,
  allowed: promptAssistantOwner,
  items: () => eachGalleryItem(),
  changes: galleryChangeCount,
  // Dream's pool too, so a Dream verdict's taste signal carries what the image shows.
  visible: hasGalleryMedia,
  image: smallImage,
  save: (item, caption) => updateGalleryJob(galleryKey(item), { caption }),
  load: runtimeLoad("captions"),
  persist: (document) => writeRuntimeDocument(dataDir, "captions", document),
});
registerIdlePassRoutes(app, "/api/gallery/captions", { work: captioner, requireAdmin });
// Dream review (domain/review.ts): each project's unseen results scored against its brief.
const dreamReview = createReview({
  writer: assistantEngine,
  idle: galleryIdle,
  allowed: (ownerId) => Boolean(dream.access(ownerId)),
  items: () => eachGalleryItem(),
  changes: galleryChangeCount,
  visible: hasGalleryMedia,
  projects: (ownerId) => projects.list(ownerId),
  explicit: (ownerId) => Boolean(dream.access(ownerId)?.uncensored),
  image: smallImage,
  save: (item, review) => updateGalleryJob(galleryKey(item), { review }),
});
// Image search (domain/image-search.ts): SigLIP 2 on the CPU, so search finds what images show.
const imageSearch = createImageSearch({
  enabled: () => flagEnabled("STUDIO_IMAGE_SEARCH"),
  encoder: createSiglip({ dataDir, fetch: hfFetch }),
  vectors: createImageVectors(runtimeDatabase(dataDir), siglipVersion),
  idle: galleryIdle,
  items: () => eachGalleryItem(),
  changes: galleryChangeCount,
  visible: (item) => filterVisibleGallery([item]).length > 0,
  image: galleryStill,
  load: runtimeLoad("image-search"),
  persist: (document) => writeRuntimeDocument(dataDir, "image-search", document),
});
registerIdlePassRoutes(app, "/api/gallery/embeddings", { work: imageSearch, requireAdmin });
// Face check (domain/face-check.ts): results made with a character, compared by face with its image.
const faceCheck = createFaceCheck({
  enabled: () => flagEnabled("STUDIO_FACE_CHECK"),
  // Studio's Hugging Face fetch (mirror, token and proxy) only for Hugging Face; GitHub plainly.
  faces: createFaces({
    dataDir,
    fetch: (url, init) =>
      url.startsWith("https://huggingface.co/") ? hfFetch(url, init) : fetch(url, init),
  }),
  idle: galleryIdle,
  items: () => eachGalleryItem(),
  changes: galleryChangeCount,
  visible: (item) => filterVisibleGallery([item]).length > 0,
  characters: (ownerId) =>
    listCards("characters", ownerId).map((card) => ({
      id: card.id,
      referenceIds: characterImageIds(card),
    })),
  image: galleryStill,
  reference: async (ownerId, assetId) =>
    (await bytesForReferenceAccount(ownerId ? { userId: ownerId } : undefined, assetId)).buffer,
  save: (item, identity) => {
    updateGalleryJob(galleryKey(item), { identity });
    if (identity.drifted) void faceRedo(item, identity);
  },
  load: runtimeLoad("face-check"),
  persist: (document) => writeRuntimeDocument(dataDir, "face-check", document),
});
registerIdlePassRoutes(app, "/api/gallery/faces", { work: faceCheck, requireAdmin });
// Face redo (domain/face-redo.ts): a drifted result made with a character runs once more, new seed.
const faceRedo = createFaceRedo({
  enabled: () => flagEnabled("STUDIO_FACE_REDO"),
  account: (ownerId) => {
    if (!multiUserEnabled) return undefined;
    const account = ownerId ? accountAccessForId(ownerId) : null;
    return account?.authenticated ? account : null;
  },
  job: (ownerId, jobId) => store.job(ownerId, jobId),
  sessionJobs: (ownerId, sessionId) => store.jobs(ownerId, sessionId),
  admit: admitGeneration,
});
onGalleryFilesDeleted((items) => imageSearch.forget(items));
// Gallery titles (domain/titles.ts): a few words from the prompt, shown as the item's title.
const titler = createTitler({
  enabled: () => flagEnabled("STUDIO_GALLERY_TITLES"),
  writer: assistantEngine,
  idle: galleryIdle,
  allowed: promptAssistantOwner,
  items: () => eachGalleryItem(),
  changes: galleryChangeCount,
  visible: (item) => filterVisibleGallery([item]).length > 0,
  save: (item, title) => updateGalleryJob(galleryKey(item), { title }),
});
// Suggested prompts (domain/suggested-prompts.ts) for items without one, such as uploads; Recreate uses them.
const suggester = createPromptSuggester({
  enabled: () => flagEnabled("STUDIO_SUGGESTED_PROMPTS"),
  writer: assistantEngine,
  idle: galleryIdle,
  allowed: promptWriterOwner,
  items: () => eachGalleryItem(),
  changes: galleryChangeCount,
  visible: (item) => filterVisibleGallery([item]).length > 0,
  image: smallImage,
  save: (item, suggestedPrompt) => updateGalleryJob(galleryKey(item), { suggestedPrompt }),
  explicit: explicitFor,
});
// Viewer next steps (domain/suggestions.ts), written while idle so the viewer shows them at once.
const nextSteps = createNextStepWork({
  enabled: () => flagEnabled("STUDIO_NEXT_STEPS"),
  suggestions,
  writer: assistantEngine,
  idle: galleryIdle,
  allowed: promptWriterOwner,
  items: () => eachGalleryItem(),
  changes: galleryChangeCount,
  visible: (item) => filterVisibleGallery([item]).length > 0,
  image: smallImage,
});

generationQueue.start();
dream.start();
finishing.start();
captioner.start();
dreamReview.start();
imageSearch.start();
faceCheck.start();
titler.start();
suggester.start();
nextSteps.start();

const upscale = registerUpscaleRoutes(app, {
  finishing,
  loadComfyContext,
  queue: generationQueue,
  store,
});

registerJobRoutes(app, { store, queue: generationQueue });
// MCP calls Studio's routes in process (mcp/studio-requests.js).
const mcpDomainRequest = createMcpDomainRequest({
  app,
  admit: admitGeneration,
  ownsItem: (ownerId, id) => {
    const item = galleryItem(id);
    return Boolean(item && (item.ownerId || "") === ownerId && !isGalleryHidden(item));
  },
});
registerGalleryErrorRoutes(app);

registerGalleryDeleteRoute(app, {
  // Deleting a finished Studio result teaches the taste profile that its owner passed it over.
  deleted: (req, items) =>
    taste.record(
      ownerIdForRequest(req),
      items
        .filter((item) => item.status === "done" && item.jobId)
        .map((item) => tasteSignal("delete", item.jobId, itemValues(item))),
    ),
});

registerComfyMediaRoutes(app);

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

// dev.mjs sets the port of Vite, which serves the page.
const devPort = process.env.STUDIO_DEV_PORT;
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
      : `\n  Studio couldn't start: ${error.message}\n`,
  );
  process.exit(1);
});
if (multiUserEnabled) listenForAgentSignIn();
server.listen(Number(port), host, () => {
  const listening = server.address().port;
  // Phone links in Settings use the bound address.
  setListeningPort(listening);
  // localhost rather than 127.0.0.1: same server, but browsers only allow passkeys
  // on a name, never on an address.
  const shownHost =
    host === "0.0.0.0" || host === "::" || host === "127.0.0.1" ? "localhost" : host;
  const pagePort = devPort || listening;
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
      console.log(
        "    No workers are set up yet. Set STUDIO_WORKERS or STUDIO_KUBERNETES_NAMESPACES.\n",
      );
      return;
    }
    // Starting before ComfyUI is fine, but say so instead of leaving people to guess.
    const comfyUrl = defaultWorker()?.url || "";
    const answering = await fetch(`${comfyUrl}/system_stats`, {
      signal: AbortSignal.timeout(3000),
    }).then(
      (response) => response.ok,
      () => false,
    );
    if (!answering)
      console.log(
        `    ComfyUI isn't answering at ${comfyUrl} yet. The studio connects once it starts.\n`,
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
  flushWorkflowPreferences();
  // The runtime database's one connection; nothing may write after this.
  store.close();
};
