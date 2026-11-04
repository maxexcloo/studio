import { mayUseFeature, visibleGenerationProfiles } from "../account-policy.js";
import {
  allowedProfile,
  currentComfyBackend,
  isDefaultBackend,
  mergeWorkerModels,
  noteWorkerProfiles,
  withComfyBackend,
  workerAvailability,
} from "../comfy/backends.js";
import { comfy, comfyUrl, demoMode, isComfyTimeout, optionsFor } from "../comfy/comfy.js";
import { families } from "../family-catalog.js";
import { customWorkflowsRevision } from "../custom-workflows.js";
import { visibleGallery } from "../gallery/store.js";
import { canonicalProfileId, profileAliasBackend, profileStore } from "../profile/store.js";
import { parkedWorkers } from "../runtime/services.ts";
import { sharedRequests } from "../shared-requests.js";
import { profileStats } from "../stats.js";
import {
  capabilityForProfile,
  defaultWorkerId,
  listWorkers,
  noWorkerMessage,
  workerById,
} from "../workers.js";
import { primeModelMetadata } from "./families.js";
import { inferModels, mockModelResult, offlineModelResult } from "./models.js";
import { uncensoredLoraNames } from "../lora/info.js";

// A worker context's catalogue, kept per node list (each fetch or stored observation is its own
// object) until the profile folder or a setting inferModels reads changes (Settings saves the
// default profiles); `none` stands for no worker.
const none = {};
const inferredModels = new WeakMap();
function inferred(info = none, stats = none, { configuredOnly = false } = {}) {
  const { STUDIO_DEFAULT_IMAGE_PROFILE, STUDIO_DEFAULT_VIDEO_PROFILE, STUDIO_ENABLE_PRESETS } =
    process.env;
  const revision = [
    customWorkflowsRevision(),
    STUDIO_DEFAULT_IMAGE_PROFILE,
    STUDIO_DEFAULT_VIDEO_PROFILE,
    STUDIO_ENABLE_PRESETS,
  ].join("|");
  const entries = inferredModels.get(info) || new Map();
  inferredModels.set(info, entries);
  const kept = entries.get(configuredOnly);
  if (kept?.revision === revision && kept.stats === stats) return kept.models;
  const models = inferModels(info, stats, { configuredOnly });
  entries.set(configuredOnly, { revision, stats, models });
  return models;
}

/**
 * The media catalogue across every worker: each worker's ComfyUI context (node list, stats and
 * model folders), the profiles it runs, and what to say when none answers. `store` keeps each
 * worker's last answer for while it is offline; `directCloud` adds the cloud profiles.
 */
export function createModelCatalogue({ store, runtime, directCloud }) {
  // Each worker's latest ComfyUI answer (node list and stats), by worker id.
  const emptyContext = { info: null, stats: null, fetchedAt: 0 };
  const contextCaches = new Map();
  const contextFor = (id = defaultWorkerId()) => contextCaches.get(id) || emptyContext;
  // A stopped extra worker fails slowly (a name that no longer resolves, a refused
  // connection), so its failure is remembered briefly rather than retried on every
  // catalogue load and run.
  // The default worker is always asked: its absence is what the studio's offline screen shows.
  const workerUnreachableForMs = 30_000;
  const workerUnreachableUntil = new Map();
  const backendUnreachable = (error) =>
    error?.status ? [502, 503, 504].includes(error.status) : !isComfyTimeout(error);

  // One fetch of a worker's context at a time: callers that arrive meanwhile share it.
  const shareContextRequest = sharedRequests();
  const catalogueReadTimeoutMs = 5000;
  // Each worker's latest failed context read, reused briefly so admission, routing and
  // eligibility do not each wait out the deadline of a hung worker in turn.
  const contextFailures = new Map();

  /**
   * A worker's node list, stats and model folders, cached for 30 seconds. A
   * request already on its way is shared, so a burst of callers (a page load's
   * models, workflows and upscale status) asks ComfyUI once. `force` always
   * skips the cache and a recent failure; callers still share a request already in flight.
   */
  function loadComfyContext({ force = false } = {}) {
    const backend = currentComfyBackend();
    const cached = contextFor(backend);
    const fresh = !force && cached.info && Date.now() - cached.fetchedAt < 30000;
    if (fresh) return Promise.resolve(cached);
    const failure = contextFailures.get(backend);
    if (!force && failure && Date.now() - failure.at < catalogueReadTimeoutMs)
      return Promise.reject(failure.error);
    return shareContextRequest(backend, () => fetchComfyContext(backend));
  }

  /**
   * The default worker's latest known context without waiting on it: its cached answer, refreshed
   * in the background once 30 seconds old, else its last stored observation. Only a worker never
   * seen is waited for. `current` says whether it answered within those 30 seconds.
   */
  function latestComfyContext() {
    const backend = currentComfyBackend();
    const cached = contextFor(backend);
    if (cached.info && Date.now() - cached.fetchedAt < 30000)
      return Promise.resolve({ ...cached, current: true });
    const worker = workerById(backend);
    const known = cached.info ? cached : worker && store.workerModels(backend, worker.url);
    if (!known?.info) return loadComfyContext().then((context) => ({ ...context, current: true }));
    loadComfyContext().catch(() => null);
    return Promise.resolve({ ...known, current: false });
  }

  async function fetchComfyContext(backend) {
    const signal = AbortSignal.timeout(catalogueReadTimeoutMs);
    const [info, stats] = await Promise.all([
      comfy("/object_info", { signal }),
      comfy("/system_stats", { signal }).catch(() => ({})),
    ]).catch((error) => {
      contextFailures.set(backend, { error, at: Date.now() });
      throw error;
    });
    contextFailures.delete(backend);
    // Model-type detection is synchronous; fetch what it needs from a remote ComfyUI first.
    await primeModelMetadata(
      {
        unet: optionsFor(info, "UNETLoader", "unet_name"),
        checkpoint: optionsFor(info, "CheckpointLoaderSimple", "ckpt_name"),
      },
      { signal },
    ).catch(() => null);
    const result = { info, stats, fetchedAt: Date.now() };
    const worker = workerById(backend);
    if (worker) {
      contextCaches.set(backend, result);
      store.saveWorkerModels(backend, worker.url, { info, stats });
    }
    return result;
  }

  /** What to say when ComfyUI does not answer: restarting on purpose, or simply not there. */
  function comfyDownMessage(detail = "") {
    const worker = workerById(currentComfyBackend());
    if (!worker) return noWorkerMessage("image");
    if (!isDefaultBackend())
      return `Can’t reach ${worker.name} at ${worker.url}. Start it, then try again.${detail ? ` (${detail})` : ""}`;
    return `Can’t reach ComfyUI at ${comfyUrl}. Start it, then try again.${detail ? ` (${detail})` : ""}`;
  }

  async function backendModels(backend, force = false) {
    const extra = !isDefaultBackend(backend);
    if (extra && Date.now() < (workerUnreachableUntil.get(backend) || 0))
      throw new Error(`${workerById(backend)?.name || "That worker"} did not answer just now.`);
    return withComfyBackend(backend, async () => {
      try {
        const context = await loadComfyContext({ force });
        const models = inferred(context.info, context.stats);
        // What this worker has, so a job for one of its profiles goes to it (routeJob).
        noteWorkerProfiles(backend, models.profiles || []);
        return { ...context, models };
      } catch (error) {
        if (extra && backendUnreachable(error))
          workerUnreachableUntil.set(backend, Date.now() + workerUnreachableForMs);
        contextCaches.delete(backend);
        throw error;
      }
    });
  }

  /** The deployments an administrator can start for a worker (Settings › Workers). */
  function workerWorkloads(worker) {
    if (!worker || !runtime) return [];
    return runtime.controller.workloads
      .filter(
        (workload) =>
          workload.kind !== "text" &&
          workload.url.replace(/\/$/, "") === worker.url.replace(/\/$/, ""),
      )
      .map((workload) => workload.id);
  }

  /**
   * The catalogue across every worker (comfy/backends.js), with whether each
   * capability's workers answered (`backends`), so MCP can refuse local video
   * while no video worker is up. One worker that runs everything keeps
   * upstream's catalogue exactly.
   */
  async function mediaModels(force = false) {
    const workers = listWorkers();
    const direct = (await directCloud?.profiles().catch(() => [])) || [];
    if (!workers.length && !direct.length)
      throw Object.assign(new Error(noWorkerMessage("image")), { noWorker: true });
    const settled = await Promise.allSettled(
      workers.map((worker) => backendModels(worker.id, force)),
    );
    const answered = workers
      .map((worker, index) => ({
        worker,
        result: settled[index].status === "fulfilled" ? settled[index].value : null,
      }))
      .filter((entry) => entry.result);
    if (demoMode && !answered.length && !direct.length)
      throw settled[0]?.reason || new Error("No worker is available.");
    const parked = await parkedWorkers(runtime?.controller, workers);
    const configured = inferred(none, none, { configuredOnly: true });
    const catalogues = workers
      .map((worker) => {
        const online = answered.find((entry) => entry.worker.id === worker.id);
        if (online) return online;
        const observed = store.workerModels(worker.id, worker.url);
        // Persist worker observations; project current runtime catalogue metadata on each read.
        const cached = observed?.info && inferred(observed.info, observed.stats);
        // Current runtime definitions replace cached custom profiles, including their permissions and defaults.
        const profiles = [
          ...(cached?.profiles || []).filter((profile) => !profile.id.startsWith("custom:")),
          ...configured.profiles,
        ]
          .filter((profile) => worker.capabilities.includes(capabilityForProfile(profile)))
          .map((profile) => ({
            ...profile,
            ready: undefined,
            availability: parked.has(worker.id) ? "parked" : "offline",
            readiness: "unknown",
          }));
        return { worker, result: { models: { ...(cached || configured), profiles } } };
      })
      .sort(
        (left, right) =>
          Number(answered.some((item) => item.worker.id === right.worker.id)) -
          Number(answered.some((item) => item.worker.id === left.worker.id)),
      );
    const backends = workerAvailability(
      new Set(answered.map(({ worker }) => worker.id)),
      workers,
      parked,
    );
    const primary = answered.find(({ worker }) => isDefaultBackend(worker.id))?.result ||
      answered[0]?.result ||
      catalogues[0]?.result || { models: offlineModelResult() };
    const complete =
      workers.length === 1 &&
      ["image", "video"].every((capability) => workers[0].capabilities.includes(capability));
    const models = complete
      ? { ...primary.models, backends }
      : {
          ...mergeWorkerModels(
            catalogues.map(({ worker, result }) => ({ worker, models: result.models })),
            inferred(),
          ),
          backends,
        };
    models.profiles = (models.profiles || []).map((profile) => {
      // Every worker shares the catalogue, so only one whose capabilities run the profile lists it.
      const listing = catalogues.filter(
        ({ worker, result }) =>
          allowedProfile(worker, profile) &&
          result.models.profiles?.some((candidate) => candidate.id === profile.id),
      );
      // Where a combined profile's backend is ready on some workers only, those are its workers.
      const ready = listing.filter(({ result }) =>
        result.models.profiles.some(
          (candidate) => candidate.id === profile.id && candidate.ready !== false,
        ),
      );
      return {
        ...profile,
        workerIds: (profile.backendOptions && ready.length ? ready : listing).map(
          ({ worker }) => worker.id,
        ),
      };
    });
    if (direct.length) {
      const ids = new Set(direct.map((profile) => profile.id));
      models.profiles = [...models.profiles.filter((profile) => !ids.has(profile.id)), ...direct];
    }
    for (const kind of ["image", "video"]) {
      models[`${kind}Models`] = models.profiles
        .filter((profile) => profile.kind === kind)
        .map((profile) => ({ label: profile.label, value: profile.id }));
      if (!models.profiles.some((profile) => profile.id === models.defaults?.[`${kind}Model`]))
        models.defaults = {
          ...models.defaults,
          [`${kind}Model`]: models.profiles.find((profile) => profile.kind === kind)?.id || "",
        };
    }
    models.capabilities = {
      ...models.capabilities,
      image: models.profiles.some((profile) => profile.kind === "image"),
      video: models.profiles.some((profile) => profile.kind === "video"),
    };
    if (!answered.length && workers.length)
      models.reason = workers.every((worker) => parked.has(worker.id))
        ? "Configured workers are stopped: an administrator can start them in Settings › Workers."
        : "Configured workers are offline. Selected jobs wait until their worker is available.";
    models.workers = workers.map((worker) => {
      const available = answered.some((entry) => entry.worker.id === worker.id);
      const workloads = workerWorkloads(worker);
      return {
        id: worker.id,
        name: worker.name,
        capabilities: worker.capabilities,
        available,
        ...(!available && parked.has(worker.id) ? { parked: true } : {}),
        // The deployments an administrator can start for it (Settings › Workers).
        ...(workloads.length ? { workloads } : {}),
      };
    });
    return { primary, models };
  }

  /** /api/models with no worker answering: nothing to run, with the plain reason. */
  function unavailableModels() {
    if (demoMode) return mockModelResult();
    if (!listWorkers().length)
      return {
        ...inferred(),
        reason: noWorkerMessage("image"),
        backends: workerAvailability(),
      };
    return offlineModelResult(comfyUrl);
  }

  /** The media catalogue; demo mode without workers serves its sample one. */
  const catalogueModels = () =>
    mediaModels(false)
      .then((result) => result.models)
      .catch((error) => {
        if (demoMode) return mockModelResult();
        throw error;
      });

  /** The current worker's profiles as its node list describes them, for presets and the Library. */
  const presetModels = async () => {
    const { info, stats } = await loadComfyContext().catch(() => ({ info: null, stats: null }));
    return info ? inferModels(info, stats) : demoMode ? mockModelResult() : offlineModelResult();
  };

  return {
    catalogueModels,
    comfyDownMessage,
    latestComfyContext,
    loadComfyContext,
    mediaModels,
    presetModels,
    unavailableModels,
    workerWorkloads,
  };
}

export function modelsForAccount(models, req) {
  if (!req.studioAccount) return models;
  const lorasOn = mayUseFeature(req.studioAccount, "loras");
  const allowed = lorasOn ? loraAllowed(req.studioAccount) : null;
  const profiles = visibleGenerationProfiles(models.profiles || [], req.studioAccount).map(
    (profile) => {
      if (lorasOn)
        return Array.isArray(profile.options?.loras)
          ? {
              ...profile,
              options: { ...profile.options, loras: profile.options.loras.filter(allowed) },
            }
          : profile;
      return {
        ...profile,
        capabilities: { ...profile.capabilities, lora: false },
        options: { ...profile.options, loras: [] },
      };
    },
  );
  // Saved images stay administration: they are shared across Studio.
  const features = models.features
    ? {
        ...models.features,
        presets: Boolean(models.features.presets) && req.studioAccount.role === "administrator",
      }
    : models.features;
  return {
    ...models,
    loras: lorasOn ? (models.loras || []).filter(allowed) : [],
    profiles,
    ...(features ? { features } : {}),
  };
}

/**
 * Each profile lists the merged ids that now resolve to it, so the browser can match records that
 * name them, and the backend each per-backend id ran on (`aliasBackends`), so reruns keep it.
 */
export function withProfileAliases(models) {
  const aliases = {};
  const backends = {};
  for (const id of Object.keys(profileStore().aliases())) {
    const kept = canonicalProfileId(`custom:${id}`);
    (aliases[kept] ||= []).push(`custom:${id}`);
    const backend = profileAliasBackend(id);
    if (backend) (backends[kept] ||= {})[`custom:${id}`] = backend;
  }
  if (!Object.keys(aliases).length || !models?.profiles) return models;
  return {
    ...models,
    profiles: models.profiles.map((profile) =>
      aliases[profile.id]
        ? {
            ...profile,
            aliases: aliases[profile.id],
            ...(backends[profile.id] ? { aliasBackends: backends[profile.id] } : {}),
          }
        : profile,
    ),
  };
}

/** Profiles whose recent runs mostly fail carry `failing`: the composer badges them and MCP's own pick passes them over. */
// The visible gallery's profile health, counted again when the gallery changes or a minute on.
let profileHealth = { items: null, at: 0, stats: {} };

export function withFailing(models) {
  if (!models?.profiles) return models;
  const items = visibleGallery();
  if (profileHealth.items !== items || Date.now() - profileHealth.at > 60_000)
    profileHealth = { items, at: Date.now(), stats: profileStats(items) };
  const { stats } = profileHealth;
  return {
    ...models,
    profiles: models.profiles.map((profile) =>
      stats[profile.id]?.failing ? { ...profile, failing: true } : profile,
    ),
  };
}

export function accountMayUseLoras(req) {
  return !req.studioAccount || mayUseFeature(req.studioAccount, "loras");
}

/**
 * Which LoRA names an account may see and use: one the catalogue marks uncensored needs Uncensored
 * Models, as an uncensored profile does. Without an account (single-user mode) every LoRA is allowed.
 */
export function loraAllowed(access) {
  if (!access || mayUseFeature(access, "uncensoredModels")) return () => true;
  const hidden = uncensoredLoraNames();
  return (name) => !hidden.has(name);
}

// Every family's display name, from the catalogue that defines the family.
export const familyLabels = Object.fromEntries(
  Object.entries(families).map(([id, family]) => [id, family.label]),
);
