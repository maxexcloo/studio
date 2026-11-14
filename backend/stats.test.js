import assert from "node:assert/strict";
import test from "node:test";

import { galleryStats, profileStats } from "./stats.js";

const done = (extra = {}) => ({ status: "done", type: "image", durationMs: 1000, ...extra });

test("counts finished images and videos, cloud jobs, and local runs' GPU time", () => {
  const stats = galleryStats([
    done({ timing: { runMs: 400 } }),
    done({ type: "video" }),
    done({ jobId: "grok-1", settings: { profileId: "grok-imagine" } }),
    done({ jobId: "grok-1", settings: { profileId: "grok-imagine" } }),
    { status: "failed", durationMs: 5000 },
  ]);
  assert.deepEqual(stats, { outputs: 4, images: 3, videos: 1, cloudJobs: 1, gpuMs: 1400 });
});

test("profile stats count the last 30 days and flag a profile failing most of its recent runs", () => {
  const now = Date.parse("2026-10-26T12:00:00Z");
  const run = (profileId, status, daysAgo, extra = {}) => ({
    status,
    createdAt: new Date(now - daysAgo * 86_400_000).toISOString(),
    settings: { profileId },
    ...extra,
  });
  const stats = profileStats(
    [
      run("steady", "done", 1, { favorite: true, timing: { runMs: 9000 } }),
      run("steady", "done", 2, { timing: { runMs: 11000 } }),
      run("steady", "failed", 3),
      run("steady", "cancelled", 1),
      run("steady", "done", 40),
      ...Array.from({ length: 5 }, (_, index) => run("broken", index ? "failed" : "done", index)),
    ],
    now,
  );
  assert.deepEqual(stats.steady, {
    runs: 3,
    failed: 1,
    starred: 1,
    lastAt: new Date(now - 86_400_000).toISOString(),
    medianRunMs: 11000,
    failing: false,
  });
  assert.equal(stats.broken.failing, true);
  assert.equal(stats.broken.failed, 4);
});
