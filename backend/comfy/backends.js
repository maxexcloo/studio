import { logWarning } from "../crash-log.js";
import {
  capabilityForProfile,
  defaultWorkerId,
  listWorkers,
  noWorkerMessage,
  pickWorker,
  workerById,
} from "../workers.js";

export const configuredBackends = () => listWorkers().map((worker) => worker.id);
export const isDefaultBackend = (backend) => Boolean(backend) && backend === defaultWorkerId();

/** The address of worker `id`. */
export function workerUrl(id) {
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
// A worker that failed to answer is passed over (routing, catalogue reads) and tried again after
// this long: nothing else is sent to it, so waiting for its next answer would leave it out for good.
const retryUnreachableMs = 60_000;
const inventories = new Map();
const offlineListeners = new Set();
let parkedCheck = async () => false;
/** Says whether a worker was stopped on purpose, whose silence is no outage to log. */
export const setParkedCheck = (check) => {
  parkedCheck = check;
};
/**
 * `error` says why it failed to answer and `at` when it answered or failed to (tests give a time).
 * Only changes are logged, so a worker can be told apart from Studio going down.
 */
export const noteWorkerReachable = (id, up, error, at = Date.now()) => {
  if (!id) return;
  const last = reachable.get(id);
  if (!up && last?.up !== false) {
    const reason = error?.cause?.code || error?.code || error?.message || String(error ?? "");
    void parkedCheck(id)
      .catch(() => false)
      .then((parked) => parked || logWarning("Worker stopped answering", { worker: id, reason }));
  } else if (up && last?.up === false)
    logWarning("Worker answering again", {
      worker: id,
      downForS: Math.round((at - last.since) / 1000),
    });
  reachable.set(id, { up: Boolean(up), at, since: up || last?.up !== false ? at : last.since });
  if (!up) for (const listener of offlineListeners) listener(id);
};
/** Hears the id of each worker found offline. */
export const onWorkerOffline = (listener) => offlineListeners.add(listener);
/** True once it answered, false while it recently failed to, null when not known (or due a retry). */
export const workerReachable = (id, now = Date.now()) => {
  const last = reachable.get(id);
  if (!last) return null;
  return last.up || now - last.at < retryUnreachableMs ? last.up : null;
};
/** How a worker's inventory names a profile on one backend of a combined profile. */
export const profileOnBackendKey = (profileId, backend = "") =>
  backend ? `${profileId}@${backend}` : profileId;
/** Logs the profiles a worker stops offering, which routing then sends elsewhere. */
export const noteWorkerProfiles = (id, profiles = []) => {
  if (!id) return;
  const next = new Set(
    profiles.flatMap((profile) => [
      ...(profile.ready !== false ? [profile.id] : []),
      // Each backend this worker can run it on, so a run on the other backend routes to it.
      ...(profile.backendOptions || [])
        .filter((option) => option.ready)
        .map((option) => profileOnBackendKey(profile.id, option.id)),
    ]),
  );
  const dropped = [...(inventories.get(id) || [])].filter((profile) => !next.has(profile));
  if (dropped.length) logWarning("Worker no longer offers profiles", { worker: id, dropped });
  inventories.set(id, next);
};

/**
 * The worker for a job: `capability` it needs, the `profileId` it runs (a
 * worker that already has it wins), capabilities it would rather have
 * (`prefers`, such as upscale for Smart upscale) and, for queued work, the
 * queue's `loads` by resource with the job's `model` and whether it is
 * background work (`last`); see pickWorker. Null when none can.
 */
export function routeJob(
  capability,
  { profileId = "", prefers = [], loads = new Map(), model = "", last = false } = {},
) {
  return pickWorker(capability, {
    prefers,
    load: (id) => loads.get(`worker:${id}`) || null,
    model,
    last,
    online: workerReachable,
    hasModel: (id) =>
      profileId && inventories.has(id) ? inventories.get(id).has(profileId) : null,
  });
}

/**
 * The workers that could take a queued job now: capable, not known to be down and not known to
 * lack its profile, in list order.
 */
export const readyWorkers = (capability, profileId = "") =>
  listWorkers().filter(
    (worker) =>
      worker.capabilities.includes(capability) &&
      workerReachable(worker.id) !== false &&
      !(profileId && inventories.has(worker.id) && !inventories.get(worker.id).has(profileId)),
  );

/**
 * The workers queued work may move to: ready ones, except a worker Studio scales (`scaled`) that
 * isn't answering. Moved to a stopped worker, work would start a GPU switch for it, and a worker
 * due a retry would take it back and forth.
 */
export const moveTargets = (capability, profileId, scaled) =>
  readyWorkers(capability, profileId).filter(
    (worker) => workerReachable(worker.id) || !scaled(worker),
  );

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

const isLocalVideoProfile = (profile) => capabilityForProfile(profile) === "video";

/** Whether `worker` may run `profile`: local video on video workers, everything else on image workers. */
export const allowedProfile = (worker, profile) =>
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
    profiles,
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
 * (never sending it to the cloud by itself). `parked` marks a capability whose workers were all
 * stopped on purpose, so it is reported as parked rather than down.
 */
export function workerAvailability(
  answered = new Set(),
  workers = listWorkers(),
  parked = new Set(),
) {
  return Object.fromEntries(
    ["image", "video", "upscale"].map((capability) => {
      const capable = workers.filter((worker) => worker.capabilities.includes(capability));
      const available = capable.some((worker) => answered.has(worker.id));
      return [
        capability,
        {
          configured: capable.length > 0,
          available,
          ...(!available && capable.length && capable.every((worker) => parked.has(worker.id))
            ? { parked: true }
            : {}),
        },
      ];
    }),
  );
}
