import { isCloudProfile } from "../../shared/profiles.ts";
import { mayUseFeature, visibleGenerationProfiles } from "../account-policy.js";
import { kindDefaults } from "../account-preferences.js";
import {
  allowedProfile,
  isDefaultBackend,
  mergeWorkerModels,
  noteWorkerProfiles,
  workerAvailability,
  workerReachable,
} from "../comfy/backends.js";
import { comfy, noteComfyFetchError, noteComfyReachable, optionsFor } from "../comfy/comfy.js";
import { logWarning } from "../crash-log.js";
import { customWorkflowsRevision } from "../custom-workflows.js";
import { step } from "../event-loop.js";
import { families } from "../family-catalogue.js";
import { uncensoredLoraNames } from "../lora/info.js";
import { RadianceClient, radianceInfo } from "../providers/radiance.ts";
import { parkedWorkers } from "../runtime/services.ts";
import { sharedRequests } from "../shared-requests.js";
import { profileStats, recentRuns } from "../stats.js";
import {
  defaultWorkerId,
  isRadianceWorker,
  listWorkers,
  modelLibraryWorker,
  noWorkerMessage,
  workerById,
} from "../workers.js";
import { primeModelMetadata } from "./families.js";
import { inferModels, offlineModelResult } from "./models.js";

// A worker context's catalogue, kept per node list (each fetch or stored observation is its own
// object) until the profile folder or a setting inferModels reads changes (Settings saves the
// default profiles); `none` stands for no worker.
const none = {};
const inferredModels = new WeakMap();
function inferred(info = none, stats = none, { configuredOnly = false } = {}) {
  const { STUDIO_DEFAULT_IMAGE_PROFILE, STUDIO_DEFAULT_VIDEO_PROFILE } = process.env;
  const revision = [
    customWorkflowsRevision(),
    STUDIO_DEFAULT_IMAGE_PROFILE,
    STUDIO_DEFAULT_VIDEO_PROFILE,
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
  const contextFor = (id) => contextCaches.get(id) || emptyContext;

  // One fetch of a worker's context at a time: callers that arrive meanwhile share it.
  const shareContextRequest = sharedRequests();
  const catalogueReadTimeoutMs = 5000;
  // Each worker's latest failed context read, reused briefly so admission, routing and
  // eligibility do not each wait out the deadline of a hung worker in turn.
  const contextFailures = new Map();

  /**
   * Worker `backend`'s node list, stats and model folders, cached for 30 seconds. A
   * request already on its way is shared, so a burst of callers (a page load's
   * models, workflows and upscale status) asks ComfyUI once. `force` always
   * skips the cache and a recent failure; callers still share a request already in flight.
   */
  function loadComfyContext(backend, { force = false } = {}) {
    const cached = contextFor(backend);
    const fresh = !force && cached.info && Date.now() - cached.fetchedAt < 30000;
    if (fresh) return Promise.resolve(cached);
    const failure = contextFailures.get(backend);
    if (!force && failure && Date.now() - failure.at < catalogueReadTimeoutMs)
      return Promise.reject(failure.error);
    return shareContextRequest(backend, () => fetchComfyContext(backend));
  }

  async function fetchComfyContext(backend) {
    const signal = AbortSignal.timeout(catalogueReadTimeoutMs);
    const worker = workerById(backend);
    if (isRadianceWorker(worker)) return fetchRadianceContext(worker, signal);
    const [info, stats] = await Promise.all([
      // The node list is megabytes and may take seconds to cross between sites once it starts.
      comfy(backend, "/object_info", { answerWithin: catalogueReadTimeoutMs }),
      comfy(backend, "/system_stats", { signal }).catch(() => ({})),
    ]).catch((error) => {
      contextFailures.set(backend, { error, at: Date.now() });
      throw error;
    });
    contextFailures.delete(backend);
    // Model-type detection is synchronous; fetch what it needs from a remote ComfyUI first.
    await primeModelMetadata(
      backend,
      {
        unet: optionsFor(info, "UNETLoader", "unet_name"),
        checkpoint: optionsFor(info, "CheckpointLoaderSimple", "ckpt_name"),
      },
      { signal },
    ).catch(() => null);
    const result = { info, stats, fetchedAt: Date.now() };
    if (worker) {
      contextCaches.set(backend, result);
      store.saveWorkerModels(backend, worker.url, { info, stats });
    }
    return result;
  }

  /** A Radiance worker's context: its two nodes, listing the models it serves, and their states. */
  async function fetchRadianceContext(worker, signal) {
    let models;
    try {
      models = await new RadianceClient(worker.url).models(signal);
      noteComfyReachable(worker.id);
    } catch (error) {
      contextFailures.set(worker.id, { error, at: Date.now() });
      noteComfyFetchError(worker.id, error);
      throw error;
    }
    contextFailures.delete(worker.id);
    // Radiance's native per-model inventory endpoint would load a cold model.
    const result = {
      info: radianceInfo(models, installedLoras()),
      stats: { radiance: models },
      fetchedAt: Date.now(),
    };
    contextCaches.set(worker.id, result);
    store.saveWorkerModels(worker.id, worker.url, { info: result.info, stats: result.stats });
    return result;
  }

  /**
   * The installed model files as the model library worker's node list names them: its latest, else
   * its last stored one wherever it was observed (null when never). Every worker loads models from
   * that shared folder, so they stay listed while its ComfyUI is parked or has moved; nothing here
   * waits on a worker. `current` says whether it answered within 30 seconds; `refresh` asks it
   * again in the background when it has not.
   */
  function libraryInventory({ refresh = false } = {}) {
    const library = modelLibraryWorker();
    if (!library) return { info: null, current: false };
    const cached = contextFor(library.id);
    const current = Boolean(cached.info) && Date.now() - cached.fetchedAt < 30000;
    if (refresh && !current) loadComfyContext(library.id).catch(() => null);
    return { info: cached.info || store.workerModels(library.id)?.info || null, current };
  }
  const installedLoras = () => optionsFor(libraryInventory().info, "LoraLoader", "lora_name");

  /** What to say when worker `backend`'s ComfyUI does not answer. */
  function comfyDownMessage(backend, detail = "") {
    const worker = workerById(backend);
    if (!worker) return noWorkerMessage("image");
    const name = isDefaultBackend(backend) ? "ComfyUI" : worker.name;
    return `Can't reach ${name}. Start it, then try again.${detail ? ` (${detail})` : ""}`;
  }

  /**
   * A worker's catalogue. Without `force`, a worker that has answered before serves its last answer
   * at once and, once that is 30 seconds old, is asked again in the background: reading the
   * catalogue never waits on a worker's node list, which a large remote ComfyUI takes seconds to send.
   */
  async function backendModels(backend, force = false) {
    // A stopped extra worker fails slowly (a name that no longer resolves, a refused connection), so
    // it is not asked again while its failure is recent (backends.js). The default worker is always
    // asked: its absence is what the studio's offline screen shows.
    if (!isDefaultBackend(backend) && workerReachable(backend) === false)
      throw new Error(`${workerById(backend)?.name || "That worker"} did not answer just now.`);
    const forget = () => contextCaches.delete(backend);
    try {
      const known = !force && contextFor(backend).info ? contextFor(backend) : null;
      if (known && Date.now() - known.fetchedAt >= 30000) loadComfyContext(backend).catch(forget);
      const context = known || (await loadComfyContext(backend, { force }));
      const models = inferred(context.info, context.stats);
      // What this worker has, so a job for one of its profiles goes to it (routeJob).
      noteWorkerProfiles(backend, models.profiles || []);
      return { ...context, models };
    } catch (error) {
      forget(error);
      throw error;
    }
  }

  /** The deployments an administrator can start for a worker (Settings › Workers). */
  function workerWorkloads(worker) {
    if (!worker || !runtime) return [];
    return runtime.controller.workloads
      .filter((workload) => workload.url.replace(/\/$/, "") === worker.url.replace(/\/$/, ""))
      .map((workload) => workload.id);
  }

  /**
   * The catalogue across every worker (comfy/backends.js), with whether each
   * capability's workers answered (`backends`), so MCP can refuse local video
   * while no video worker is up. One worker that runs everything keeps
   * upstream's catalogue exactly. Without `wait`, a worker not read since Studio started counts as
   * not answering (its stored observation stands in) and is read in the background.
   */
  async function mediaModels(force = false, { wait = true } = {}) {
    const workers = listWorkers();
    const direct =
      (await step("models: cloud", () => directCloud?.profiles().catch(() => []))) || [];
    if (!workers.length && !direct.length)
      throw Object.assign(new Error(noWorkerMessage("image")), { noWorker: true });
    const stopped = await step("models: parked", () => parkedWorkers(runtime?.controller, workers));
    // A stopped worker has no pod to answer, so it isn't asked (or logged as not answering).
    const settled = await step("models: read workers", () =>
      Promise.allSettled(
        workers.map((worker) =>
          stopped.has(worker.id)
            ? Promise.reject(new Error("stopped"))
            : wait || contextFor(worker.id).info
              ? backendModels(worker.id, force)
              : (backendModels(worker.id).catch(() => null), Promise.reject(new Error("unread"))),
        ),
      ),
    );
    const answered = workers
      .map((worker, index) => ({
        worker,
        result: settled[index].status === "fulfilled" ? settled[index].value : null,
      }))
      .filter((entry) => entry.result);
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
          .filter((profile) => allowedProfile(worker, profile))
          .map((profile) => ({
            ...profile,
            ready: undefined,
            availability: stopped.has(worker.id) ? "parked" : "offline",
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
      stopped,
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
      models.reason = workers.every((worker) => stopped.has(worker.id))
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
        ...(!available && stopped.has(worker.id) ? { parked: true } : {}),
        // The deployments an administrator can start for it (Settings › Workers).
        ...(workloads.length ? { workloads } : {}),
      };
    });
    return { primary, models };
  }

  /** /api/models with no worker answering: nothing to run, with the plain reason. */
  function unavailableModels() {
    if (!listWorkers().length)
      return {
        ...inferred(),
        reason: noWorkerMessage("image"),
        backends: workerAvailability(),
      };
    return offlineModelResult();
  }

  /** The media catalogue. */
  const catalogueModels = () => mediaModels(false).then((result) => result.models);

  /** The default worker's profiles as its node list describes them, for presets and the Library. */
  const presetModels = async () => {
    const { info, stats } = await loadComfyContext(defaultWorkerId()).catch(() => ({
      info: null,
      stats: null,
    }));
    return info ? inferModels(info, stats) : offlineModelResult();
  };

  return {
    catalogueModels,
    comfyDownMessage,
    installedLoras,
    libraryInventory,
    loadComfyContext,
    mediaModels,
    presetModels,
    unavailableModels,
    workerWorkloads,
  };
}

/**
 * The profiles Dream may run from an account's catalogue (modelsForAccount): every ready one
 * the composer offers except those on a worker stopped on purpose. A worker whose node list did not
 * arrive in time still counts, as Dream asks whether each kind's worker answers before using this.
 * Each kind's default is the catalogue's where Dream may run it, else its first such profile.
 */
export function dreamCatalogue(models) {
  const profiles = (models.profiles || []).filter(
    (profile) => profile.ready !== false && profile.availability !== "parked",
  );
  const defaults = {};
  for (const kind of ["image", "video"]) {
    const key = `${kind}Model`;
    const own = profiles.filter((profile) => profile.kind === kind);
    defaults[key] = (own.find((profile) => profile.id === models.defaults?.[key]) || own[0])?.id;
  }
  return { profiles, defaults };
}

/**
 * The account's default image and video profiles on the side its Images and Videos preferences
 * choose (account-preferences.js `kindDefaults`; Local unless Cloud): its own default for that side
 * where it can run, else the deployment's default where it is on that side and can run, else that
 * side's first that can. A side with none that can run (no cloud profile for the account, or local
 * ones not installed or their workers Offline or Stopped) gives way to the other, and
 * `defaultNotes` says so; with neither, the deployment's default stays and its jobs wait. A profile
 * the person picks always wins over these.
 */
export function withPreferredDefaults(models, preferences) {
  const defaults = { ...models.defaults };
  const defaultNotes = {};
  for (const kind of ["image", "video"]) {
    const key = `${kind}Model`;
    const own = kindDefaults(preferences, `${kind}s`);
    const cloudFirst = own.side === "cloud";
    const runnable = (models.profiles || []).filter(
      (profile) =>
        profile.kind === kind &&
        profile.ready !== false &&
        !["offline", "parked"].includes(profile.availability),
    );
    const pick = (cloud) => {
      const side = runnable.filter((profile) => isCloudProfile(profile) === cloud);
      const chosen = own[cloud ? "cloud" : "local"];
      return (
        side.find((profile) => profile.id === chosen) ||
        side.find((profile) => profile.id === defaults[key]) ||
        side[0]
      );
    };
    const preferred = pick(cloudFirst);
    const other = preferred ? undefined : pick(!cloudFirst);
    if (preferred || other) defaults[key] = (preferred || other).id;
    if (other)
      defaultNotes[kind] = cloudFirst
        ? `No cloud ${kind} model is available, so this runs locally.`
        : `No local ${kind} model is running, so this runs in the cloud.`;
  }
  return { ...models, defaults, defaultNotes };
}

export function modelsForAccount(models, req) {
  if (!req.studioAccount) return models;
  const lorasOn = mayUseFeature(req.studioAccount, "loras");
  const allowed = lorasOn ? loraAllowed(req.studioAccount) : null;
  const applyLoraAccess = (profile) => {
    const own = lorasOn
      ? Array.isArray(profile.options?.loras)
        ? {
            ...profile,
            options: { ...profile.options, loras: profile.options.loras.filter(allowed) },
          }
        : profile
      : {
          ...profile,
          capabilities: { ...profile.capabilities, lora: false },
          options: { ...profile.options, loras: [] },
        };
    return profile.backendOptions?.length
      ? {
          ...own,
          backendOptions: profile.backendOptions.map((option) =>
            option.profile ? { ...option, profile: applyLoraAccess(option.profile) } : option,
          ),
        }
      : own;
  };
  const profiles = visibleGenerationProfiles(models.profiles || [], req.studioAccount).map(
    applyLoraAccess,
  );
  return {
    ...models,
    loras: lorasOn ? (models.loras || []).filter(allowed) : [],
    profiles,
  };
}

/** Profiles whose recent runs mostly fail carry `failing`: the composer badges them and MCP's own pick passes them over. */
// The visible gallery's profile health, counted in the background at most once a minute; a
// catalogue read meanwhile uses the last count.
let profileHealth = { at: -Infinity, stats: {}, counting: false };

export function withFailing(models) {
  if (!models?.profiles) return models;
  if (!profileHealth.counting && Date.now() - profileHealth.at > 60_000) {
    profileHealth.counting = true;
    recentRuns()
      .then(
        (runs) => (profileHealth = { at: Date.now(), stats: profileStats(runs), counting: false }),
      )
      .catch((error) => {
        profileHealth.counting = false;
        logWarning(`Profile health couldn't be counted: ${error.message}`);
      });
  }
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
