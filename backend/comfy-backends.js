import { AsyncLocalStorage } from "node:async_hooks";
import { families } from "./family-catalog.js";
import {
  capabilityForProfile,
  defaultWorkerId,
  listWorkers,
  noWorkerMessage,
  pickWorker,
  workerById,
} from "./workers.js";

// Per-operation context, never a mutable global URL: jobs on different workers overlap.
// The scope holds a worker id (workers.js); outside any scope it is the default worker.
const backendScope = new AsyncLocalStorage();
export const currentComfyBackend = () => backendScope.getStore() || defaultWorkerId();
export const withComfyBackend = (backend, operation) =>
  backendScope.run(String(backend || defaultWorkerId() || ""), operation);
export const configuredBackends = () => listWorkers().map((worker) => worker.id);
export const isDefaultBackend = (backend = currentComfyBackend()) =>
  Boolean(backend) && backend === defaultWorkerId();

/** The address of the worker this operation runs on. */
export function backendUrl() {
  const id = currentComfyBackend();
  if (!id)
    throw Object.assign(new Error(noWorkerMessage("image")), { status: 503, noWorker: true });
  const worker = workerById(id);
  if (!worker)
    throw Object.assign(new Error("That worker is no longer configured."), {
      status: 503,
      noWorker: true,
    });
  return worker.url;
}

/*
 * What Studio knows about each worker without asking it again: whether its
 * last answer came back, and which profiles its latest catalogue had. Routing
 * (pickWorker) reads these; nothing here makes a request.
 */
const reachable = new Map();
const inventories = new Map();
export const noteWorkerReachable = (id, up) => {
  if (id) reachable.set(id, Boolean(up));
};
const workerReachable = (id) => (reachable.has(id) ? reachable.get(id) : null);
/** How a worker's inventory names a profile on one backend of a combined profile. */
export const profileOnBackendKey = (profileId, backend = "") =>
  backend ? `${profileId}@${backend}` : profileId;
export const noteWorkerProfiles = (id, profiles = []) => {
  if (id)
    inventories.set(
      id,
      new Set(
        profiles.flatMap((profile) => [
          ...(profile.ready !== false ? [profile.id] : []),
          // Each backend this worker can run it on, so a run on the other backend routes to it.
          ...(profile.backendOptions || [])
            .filter((option) => option.ready)
            .map((option) => profileOnBackendKey(profile.id, option.id)),
        ]),
      ),
    );
};
export function forgetWorkerState(id) {
  reachable.delete(id);
  inventories.delete(id);
}

/**
 * The worker for a job: `capability` it needs, the `profileId` it runs (a
 * worker that already has it wins) and capabilities it would rather have
 * (`prefers`, such as upscale for Smart upscale). Null when none can.
 */
export function routeJob(capability, { profileId = "", prefers = [] } = {}) {
  return pickWorker(capability, {
    prefers,
    online: workerReachable,
    hasModel: (id) =>
      profileId && inventories.has(id) ? inventories.get(id).has(profileId) : null,
  });
}

/** routeJob for a profile, or an error that says plainly why nothing can run it. */
export function routeProfile(profile, options = {}) {
  const capability = capabilityForProfile(profile);
  const worker = routeJob(capability, {
    profileId: profileOnBackendKey(profile?.id || "", options.backend),
    ...options,
  });
  if (!worker)
    throw Object.assign(new Error(noWorkerMessage(capability)), {
      status: 503,
      noWorker: true,
      capability,
    });
  return worker;
}

export const isLocalVideoProfile = (profile) => capabilityForProfile(profile) === "video";

const allowedProfile = (worker, profile) =>
  isLocalVideoProfile(profile)
    ? worker.capabilities.includes("video")
    : worker.capabilities.includes("image");

/**
 * One catalogue from every worker's own: each worker contributes the profiles
 * its capabilities allow (local video from video workers; images and
 * provider-backed runs from image workers), the first worker in list order
 * winning a profile both have. `entries` is `[{ worker, models }]`, in list
 * order, for the workers that answered; `empty` stands in when none did.
 */
export function mergeWorkerModels(entries, empty = {}) {
  const seen = new Map();
  const profiles = [];
  for (const { worker, models } of entries) {
    for (const profile of models.profiles || []) {
      if (!allowedProfile(worker, profile)) continue;
      const index = seen.get(profile.id);
      if (index === undefined) {
        seen.set(profile.id, profiles.length);
        profiles.push(profile);
        continue;
      }
      // A combined profile is ready where any worker runs its backend: that worker's entry wins.
      const kept = profiles[index];
      if (!kept.backendOptions?.length) continue;
      const backendOptions = kept.backendOptions.map((option) => {
        const other = profile.backendOptions?.find((candidate) => candidate.id === option.id);
        return option.ready || !other || other.ready === undefined ? option : other;
      });
      profiles[index] = {
        ...(kept.ready === false && profile.ready !== false ? profile : kept),
        backendOptions,
      };
    }
  }
  const images = profiles.filter((profile) => profile.kind === "image");
  const videos = profiles.filter((profile) => profile.kind === "video");
  const videoFamily = (file) => families[file.family]?.kind === "video";
  const fileNames = new Set();
  const modelFiles = [];
  for (const { worker, models } of entries) {
    for (const file of models.modelFiles || []) {
      if (
        !(videoFamily(file)
          ? worker.capabilities.includes("video")
          : worker.capabilities.includes("image")) ||
        fileNames.has(file.name)
      )
        continue;
      fileNames.add(file.name);
      modelFiles.push(file);
    }
  }
  const first = (capability) =>
    entries.find(({ worker }) => worker.capabilities.includes(capability))?.models;
  const selected = (list, preferred) =>
    list.find((profile) => profile.id === preferred && profile.ready !== false)?.id ||
    list.find((profile) => profile.ready !== false)?.id ||
    list[0]?.id ||
    "";
  const base =
    entries.find(({ models }) => models.profiles?.length)?.models || entries[0]?.models || empty;
  const result = {
    ...base,
    modelFiles,
    profiles,
    unsupportedModels: modelFiles.filter((file) => !file.supported).map((file) => file.name),
    imageModels: images.map((profile) => ({ label: profile.label, value: profile.id })),
    videoModels: videos.map((profile) => ({ label: profile.label, value: profile.id })),
    defaults: {
      imageModel: selected(images, first("image")?.defaults?.imageModel),
      videoModel: selected(
        videos,
        first("video")?.defaults?.videoModel || first("image")?.defaults?.videoModel,
      ),
    },
    capabilities: {
      image: images.length > 0,
      video: videos.length > 0,
      startImage: profiles.some((profile) => profile.capabilities?.startImage),
    },
  };
  for (const key of [
    "clipTypes",
    "loras",
    "samplers",
    "schedulers",
    "textEncoders",
    "vaes",
    "weightDtypes",
  ]) {
    result[key] = [...new Set(entries.flatMap(({ models }) => models[key] || []))];
  }
  return result;
}

/**
 * Per capability, whether any worker has it and whether one answered this
 * catalogue load, so MCP refuses local video while no video worker is up
 * (never sending it to the cloud by itself).
 */
export function workerAvailability(answered = new Set(), workers = listWorkers()) {
  return Object.fromEntries(
    ["image", "video", "upscale"].map((capability) => {
      const capable = workers.filter((worker) => worker.capabilities.includes(capability));
      return [
        capability,
        {
          configured: capable.length > 0,
          available: capable.some((worker) => answered.has(worker.id)),
        },
      ];
    }),
  );
}
