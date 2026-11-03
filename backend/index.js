// First: the settings (.env), so every module below reads them.
import "./env.js";
// Then: keeps a copy of data/ before a new version's stores load and migrate it.
import "./data-snapshot.js";
// Then, once: Hidden's data backed up and its readable records back in the gallery.
import { createJobRecovery } from "./job-recovery.js";
import { installShutdown } from "./shutdown.js";
import {
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
import { createChatRouter } from "./domain/chat-routes.ts";
import { queuePriority, Store } from "./domain/store.ts";
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
import { configuredCliProxy } from "./providers/cliproxy.ts";
import { createSiglip, siglipVersion } from "./providers/siglip.ts";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { composeWorkflowPrompt } from "./graphs.js";
import { studioCloudProfiles } from "./providers/profiles.ts";
import { registerMaintenanceRoutes, registerRewriteRoutes } from "./domain/routes.ts";
import { loadRuntime, registerRuntimeStatus } from "./runtime/bootstrap.ts";
import { createLocalText, createServicesObserver } from "./runtime/services.ts";
import { registerModelDownloadRoutes } from "./model/download-routes.js";
import { createModelCatalogue, modelsForAccount } from "./model/catalogue.js";
import { registerModelRoutes } from "./model/routes.js";
import { registerStatusRoutes } from "./status-routes.js";
import { createAssistantContext } from "./assistant-context.js";
import { modelFileReferences, profileDefinitions } from "./library/file-users.js";
import { draftCheckpointProfile } from "./profile/import-draft.js";
import { createGenerationQueue } from "./generation-queue.js";
import { createSessionChat } from "./chat-service.js";
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
import { registerProfileEditorRoutes, repointProfiles } from "./profile/editor.js";
import { registerProfileRoutes } from "./profile/routes.js";
import { seedSamples } from "./profile/seed.js";
import { registerAssistantRoutes } from "./assistant-routes.js";
import { createPromptStage } from "./prompt-stage.js";
import {
  canonicalProfileId,
  guideStore,
  profileStore,
  withCanonicalProfile,
} from "./profile/store.js";

import { requireAdmin } from "./route-access.js";
import express from "express";
import {
  configuredBackends,
  currentComfyBackend,
  routeJob,
  withComfyBackend,
} from "./comfy/backends.js";
import { defaultWorkerId, listWorkers, useWorkloadWorkers } from "./workers.js";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  networkListening,
  demoMode,
  comfy,
  comfyUrl,
  host,
  optionsFor,
  port,
  root,
  setListeningPort,
} from "./comfy/comfy.js";
import { clientOf } from "./access.js";
import { hostAllowed, requestGuard } from "./request-guard.js";
import { registerMcpRoutes } from "./mcp/mcp.js";
import { loadSharp } from "./sharp-loader.js";
import { appVersion } from "./data-dir.js";
import { buildProfile, mockModelResult, offlineModelResult } from "./model/models.js";
import { flagEnabled } from "./deployment-settings.js";
import { hfFetch } from "./hf-access.js";
import {
  deleteOwnedGalleryItems,
  filterVisibleGallery,
  flushGalleryStrict,
  isGalleryHidden,
  galleryKey,
  flushPendingGallery,
  makePendingItems,
  gallery,
  dataDir,
  recordsFromComfyHistory,
  setGallery,
  cleanupGalleryState,
  updateGalleryJob,
  galleryRevisionValue,
  onGalleryFilesDeleted,
} from "./gallery/store.js";
import { fillVideoSizes } from "./library/library.js";
import { startMediaWarmup } from "./media-warmup.js";
import { jobs, setTerminalJob } from "./jobs.js";
import { cancelPrompt } from "./comfy/queue.js";
import { catalogueLoraInfo, familiesFromMetadata, loraCatalogue, loraInfos } from "./lora/info.js";
import { optionalLoraPolicyIssue } from "./lora/catalogue.js";
import { strengthRange } from "./lora/policy.js";
import { loadCustomWorkflows, userWorkflowsDir } from "./custom-workflows.js";
import { registerReferenceRoutes } from "./reference-routes.js";
import { registerVideoEditRoutes } from "./gallery/video-edits.js";
import { registerRecreateRoute } from "./gallery/recreate.js";
import { registerRedditImportRoute } from "./gallery/reddit.js";

import { loadLoraLibrary } from "./lora/stacks.js";
import { bytesForReferenceAccount, galleryStill, referenceAssetForAccount } from "./references.js";
import { compressJson, serveApp } from "./http-assets.js";
import { isMediaUrl } from "./media-paths.js";
import { gatedPath } from "./gated-path.js";
import { ingestRecords, noteIngested, removeComfyFiles } from "./media-store.js";
import { forgetComfyRun } from "./comfy/traces.js";
import {
  accountForRequest,
  internalMcpHeaders,
  multiUserEnabled,
  registerMultiUserAuthRoutes,
} from "./multi-user-auth.js";
import { enforceMultiUserRequest } from "./multi-user-gate.js";
import { ownerIdForRequest, recordsForRequest } from "./account-ownership.js";
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

registerModelRoutes(app, { catalogue, libraryUpdates: () => library.updates });

registerModelDownloadRoutes(app, { loadComfyContext });
const presetRoutes = registerPresetRoutes(app, { models: presetModels });
// The Library (library/routes.js): imports, their records and grades, and what is installed with its provenance.
const unique = (...lists) => [
  ...new Set(lists.flat().filter((name) => typeof name === "string" && name)),
];
const library = registerLibraryRoutes(app, {
  presets: presetRoutes,
  catalogue: loraCatalogue,
  draftProfile: (record, options) =>
    draftCheckpointProfile(record, options, {
      engine: assistantEngine,
      info: () => profileObjectInfo("image"),
    }),
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
  references: (model) => modelFileReferences(model, presetModels),
  profileDefinitions,
  schedule: !demoMode,
});

registerWorkflowRoutes(app, { loadComfyContext });

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

// The prompt assistant (assistant-routes.js): account-scoped, behind the Prompt Assistant feature,
// reading what an account may use (assistant-context.js).
const assistant = createAssistantContext({ catalogueModels, loadComfyContext });
const assistantEngine = registerAssistantRoutes(app, {
  localText,
  frame: (req, id) => assistant.image(req.studioAccount, id),
  profiles: assistant.profiles,
  guide: assistant.guide,
  loras: assistant.loras,
  starred: assistant.starred,
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

registerLoraRoutes(app, { comfyDownMessage, loadComfyContext });

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

registerPreferenceRoutes(app);
registerPromptHistoryRoutes(app);

// An upload is searchable at once, like a finished generation.
registerReferenceRoutes(app, { uploaded: (item) => void imageSearch.completed([item]) });
registerVideoEditRoutes(app, { store });
registerRecreateRoute(app, { store });
registerRedditImportRoute(app, { uploaded: (item) => void imageSearch.completed([item]) });

registerDeploymentRoutes(app, { assistantEngine, mediaModels, runtime, unavailableModels });

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
});
// The generation queue (generation-queue.js): local workers, the direct cloud and upscales.
const { generationQueue, queueResourceFor, validateGenerationInput } = createGenerationQueue({
  assistantEngine,
  catalogue,
  cloudProvider,
  completed: (items) => {
    void titler.completed(items);
    void imageSearch.completed(items);
  },
  directCloud,
  generationRoutes,
  promptStage,
  recoverRunningJobs,
  runtime,
  store,
});
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
// It only queues work; it never places GPU workloads, and cloud profiles never take part.
const dream = createDream({
  dataDir,
  store,
  taste,
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
  writer: assistantEngine,
  guide: assistant.guide,
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

// Studio Chat (chat-service.js).
const sessionChat = createSessionChat({
  admit: admitGeneration,
  catalogueModels,
  mcp,
  referenceImage: assistant.image,
  runtime,
  store,
  taste,
  tasteWriter,
  validate: validateGenerationInput,
});
// A group's Chat feature gates Studio Chat; single-user mode has no account and keeps it.
app.use(
  "/api",
  createChatRouter(sessionChat, (req) => {
    if (req.studioAccount && !mayUseFeature(req.studioAccount, "chat"))
      throw Object.assign(new Error("Chat is off for this account."), { status: 403 });
    return ownerIdForRequest(req);
  }),
);

generationQueue.start();
dream.start();
finishing.start();
captioner.start();
imageSearch.start();
titler.start();
suggester.start();
nextSteps.start();

const upscale = registerUpscaleRoutes(app, {
  finishing,
  loadComfyContext,
  queue: generationQueue,
  store,
});

const { generationJobResponse } = registerJobRoutes(app, { store, queue: generationQueue });
// MCP's generation and its owned results go straight to the domain (mcp/studio-requests.js).
const mcpDomainRequest = createMcpDomainRequest({
  admit: admitGeneration,
  jobResponse: generationJobResponse,
  store,
});
registerGalleryErrorRoutes(app);

registerGalleryDeleteRoute(app);

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
