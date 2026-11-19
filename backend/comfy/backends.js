import { logWarning } from "../crash-log.js";
import { getCustomWorkflow } from "../custom-workflows.js";
import { radianceImageNode, radianceVideoNode } from "../providers/radiance.ts";
import {
  capabilityForProfile,
  defaultWorkerId,
  isRadianceWorker,
  listWorkers,
  noWorkerMessage,
  pickWorker,
  workerById,
} from "../workers.js";

/** The ComfyUI workers' ids; Radiance workers keep no queue or history to recover from. */
export const configuredBackends = () =>
  listWorkers()
    .filter((worker) => !isRadianceWorker(worker))
    .map((worker) => worker.id);
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
      .then((parked) => {
        const now = reachable.get(id);
        if (now && !now.up) now.parked = parked;
        if (!parked) logWarning("Worker stopped answering", { worker: id, reason });
      });
  } else if (up && last?.up === false && !last.parked)
    logWarning("Worker answering again", {
      worker: id,
      downForS: Math.round((at - last.since) / 1000),
    });
  reachable.set(id, {
    up: Boolean(up),
    at,
    since: up || last?.up !== false ? at : last.since,
    ...(!up && last?.up === false ? { parked: last.parked } : {}),
  });
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
export const forgetWorkerProfiles = (id) => inventories.delete(id);

// A catalogue read asks runsOnRadiance for every profile, backend and worker, and each lookup checks
// the whole profile folder, so answers hold until the turn ends.
let radianceAnswers;

/**
 * Whether profile `profileId` runs on Radiance nodes on `backend` (its default without one), and so
 * only on a Radiance worker; every other profile runs only on ComfyUI workers.
 */
export function runsOnRadiance(profileId, backend = "") {
  if (!radianceAnswers) {
    radianceAnswers = new Map();
    setImmediate(() => (radianceAnswers = undefined));
  }
  const key = `${profileId}\n${backend}`;
  if (!radianceAnswers.has(key)) {
    const graph = profileId ? getCustomWorkflow(profileId, backend || undefined)?.graph : null;
    radianceAnswers.set(
      key,
      Object.values(graph || {}).some((node) =>
        [radianceImageNode, radianceVideoNode].includes(node?.class_type),
      ),
    );
  }
  return radianceAnswers.get(key);
}

/** The workers of the kind (Radiance or ComfyUI) that runs `profileId` on `backend`. */
const workersFor = (profileId, backend) => {
  const radiance = runsOnRadiance(profileId, backend);
  return listWorkers().filter((worker) => isRadianceWorker(worker) === radiance);
};

/**
 * The worker for a job: `capability` it needs, the `profileId` it runs on `backend` (a
 * worker that already has it wins), capabilities it would rather have
 * (`prefers`, such as upscale for Smart upscale) and, for queued work, the
 * queue's `loads` by resource with the job's `model` and whether it is
 * background work (`last`); see pickWorker. Null when none can.
 */
export function routeJob(
  capability,
  { profileId = "", backend = "", prefers = [], loads = new Map(), model = "", last = false } = {},
) {
  const key = profileOnBackendKey(profileId, backend);
  const workers = workersFor(profileId, backend);
  const hasModel = (id) => (profileId && inventories.has(id) ? inventories.get(id).has(key) : null);
  const candidates = backend
    ? workers.filter(
        (worker) => worker.capabilities.includes(capability) && hasModel(worker.id) !== false,
      )
    : workers;
  return pickWorker(capability, {
    workers: candidates.length ? candidates : workers,
    prefers,
    load: (id) => loads.get(`worker:${id}`) || null,
    model,
    last,
    online: workerReachable,
    hasModel,
  });
}

/**
 * The workers that could take a queued job now: capable, not known to be down and not known to
 * lack its profile, in list order.
 */
export const readyWorkers = (capability, profileId = "", backend = "") => {
  const key = profileOnBackendKey(profileId, backend);
  return workersFor(profileId, backend).filter(
    (worker) =>
      worker.capabilities.includes(capability) &&
      workerReachable(worker.id) !== false &&
      !(profileId && inventories.has(worker.id) && !inventories.get(worker.id).has(key)),
  );
};

/**
 * The workers queued work may move to: ready ones, except a worker Studio scales (`scaled`) that
 * isn't answering. Moved to a stopped worker, work would start a GPU switch for it, and a worker
 * due a retry would take it back and forth.
 */
export const moveTargets = (capability, profileId, backend, scaled) =>
  readyWorkers(capability, profileId, backend).filter(
    (worker) => workerReachable(worker.id) || !scaled(worker),
  );

/** routeJob for a profile, or an error that says plainly why nothing can run it. */
export function routeProfile(profile, options = {}) {
  const capability = capabilityForProfile(profile);
  const worker = routeJob(capability, { ...options, profileId: profile?.id || "" });
  if (!worker)
    throw Object.assign(new Error(noWorkerMessage(capability)), {
      status: 503,
      noWorker: true,
      capability,
    });
  return worker;
}

export const matchesWorkerBackend = (worker, profile, backend) =>
  runsOnRadiance(profile.id, backend) === isRadianceWorker(worker);

/**
 * Whether `worker` may run `profile`: local video on video workers, everything else on image
 * workers, and on a Radiance worker only what one of its backends runs on Radiance.
 */
export const allowedProfile = (worker, profile) =>
  worker.capabilities.includes(capabilityForProfile(profile)) &&
  (profile.backendOptions?.map((option) => option.id) || [""]).some((backend) =>
    matchesWorkerBackend(worker, profile, backend),
  );

const readinessRank = (ready) => (ready === true ? 2 : ready === false ? 0 : 1);

function mergeProfile(entries) {
  const { profile } = entries[0];
  if (!profile.backendOptions?.length) return profile;

  const observations = new Map();
  for (const entry of entries) {
    for (const option of entry.profile.backendOptions || []) {
      if (!matchesWorkerBackend(entry.worker, entry.profile, option.id)) continue;
      const kept = observations.get(option.id);
      if (!kept || readinessRank(option.ready) > readinessRank(kept.option.ready))
        observations.set(option.id, { option, profile: entry.profile });
    }
  }

  const backendOptions = profile.backendOptions.map((option) => {
    const observed = observations.get(option.id);
    if (observed) return observed.option;
    // No worker can report on this option. Keep the definition for routing's no-worker check.
    return {
      ...option,
      ready: undefined,
      reason: undefined,
      ...(option.profile && {
        profile: { ...option.profile, ready: undefined, readyReason: undefined },
      }),
    };
  });
  const selected = observations.get(profile.backend);
  if (!selected)
    return {
      ...profile,
      availability: undefined,
      readiness: undefined,
      ready: false,
      readyReason: noWorkerMessage(capabilityForProfile(profile)),
      backendOptions,
    };
  return {
    ...selected.profile,
    backendOptions,
  };
}

/**
 * One catalogue from every worker's own: each worker contributes the profiles
 * its capabilities allow (local video from video workers; images and
 * provider-backed runs from image workers). Each combined option takes its
 * best observation from workers that can run it, with ties in list order.
 */
export function mergeWorkerModels(entries, empty = {}) {
  const byProfile = new Map();
  for (const { worker, models } of entries) {
    for (const profile of models.profiles || []) {
      if (!allowedProfile(worker, profile)) continue;
      if (!byProfile.has(profile.id)) byProfile.set(profile.id, []);
      byProfile.get(profile.id).push({ worker, profile });
    }
  }
  const profiles = [...byProfile.values()].map(mergeProfile);
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
    entries.find(({ models }) => models.profiles?.length && !models.reason)?.models ||
    entries.find(({ models }) => models.profiles?.length)?.models ||
    entries[0]?.models ||
    empty;
  const result = {
    ...base,
    profiles,
    imageModels: images.map((profile) => ({ label: profile.label, value: profile.id })),
    videoModels: videos.map((profile) => ({ label: profile.label, value: profile.id })),
    defaults: {
      imageModel: selected(
        images,
        process.env.STUDIO_DEFAULT_IMAGE_PROFILE || first("image")?.defaults?.imageModel,
      ),
      videoModel: selected(
        videos,
        process.env.STUDIO_DEFAULT_VIDEO_PROFILE ||
          first("video")?.defaults?.videoModel ||
          first("image")?.defaults?.videoModel,
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
