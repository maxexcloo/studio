// Numbers for the About page, Settings › Users and per-profile health. Computed from the gallery
// record only: nothing is tracked beyond what Studio already keeps about its own outputs.
import { isCloudProfile } from "../shared/profiles.ts";
import { canonicalProfileId } from "./profile/store.js";

/**
 * What these gallery items made: finished outputs, images and videos, the cloud jobs among them
 * and the GPU time of the rest (a run's own time where it is known; older items kept only the time
 * since they were asked for).
 */
export function galleryStats(items = []) {
  const done = items.filter((item) => item?.status === "done");
  const cloudJobs = new Set();
  let gpuMs = 0;
  for (const item of done) {
    if (isCloudProfile({ id: item.settings?.profileId || item.model })) {
      cloudJobs.add(item.jobId || item.id);
      continue;
    }
    gpuMs += Number(item.timing?.runMs || item.durationMs || item.elapsedMs) || 0;
  }
  return {
    outputs: done.length,
    images: done.filter((item) => item.type !== "video").length,
    videos: done.filter((item) => item.type === "video").length,
    cloudJobs: cloudJobs.size,
    gpuMs,
  };
}

const dayMs = 86_400_000;

/**
 * Each profile's last 30 days: finished and failed runs (cancelled ones say nothing about the model),
 * how many finished ones were starred, the median run time, and `failing` when at least half of five
 * or more runs in the last week failed.
 */
export function profileStats(items = [], now = Date.now()) {
  const stats = new Map();
  for (const item of items) {
    const profile = canonicalProfileId(item?.settings?.profileId);
    const at = Date.parse(item?.createdAt || "");
    if (!profile || !(now - at < 30 * dayMs)) continue;
    if (item.status !== "done" && item.status !== "failed") continue;
    const entry = stats.get(profile) || {
      runs: 0,
      failed: 0,
      starred: 0,
      times: [],
      week: 0,
      weekFailed: 0,
      lastAt: "",
    };
    entry.runs += 1;
    if (item.status === "failed") entry.failed += 1;
    else {
      if (item.favorite) entry.starred += 1;
      const ms = Number(item.timing?.runMs);
      if (ms > 0) entry.times.push(ms);
    }
    if (now - at < 7 * dayMs) {
      entry.week += 1;
      if (item.status === "failed") entry.weekFailed += 1;
    }
    if (item.createdAt > entry.lastAt) entry.lastAt = item.createdAt;
    stats.set(profile, entry);
  }
  return Object.fromEntries(
    [...stats].map(([profile, { times, week, weekFailed, ...entry }]) => {
      const sorted = times.sort((a, b) => a - b);
      return [
        profile,
        {
          ...entry,
          ...(sorted.length ? { medianRunMs: sorted[Math.floor(sorted.length / 2)] } : {}),
          failing: week >= 5 && weekFailed / week >= 0.5,
        },
      ];
    }),
  );
}
