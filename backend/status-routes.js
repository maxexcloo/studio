import fs from "node:fs";
import path from "node:path";
import { canAdmin } from "./access.js";
import { ownerIdForRequest, recordsForRequest } from "./account-ownership.js";
import { directRoute } from "./domain/direct-route.ts";
import { earliest } from "./domain/eta.ts";
import { queuePriority } from "./domain/store.ts";
import { profileOnBackendKey, readyWorkers } from "./comfy/backends.js";
import { comfyUrl, isComfyTimeout } from "./comfy/comfy.js";
import { appVersion } from "./data-dir.js";
import { diagnostics, diagnosticsText } from "./diagnostics.js";
import { dataDir, gallery, visibleGallery } from "./gallery/store.js";
import { requireAdmin } from "./route-access.js";
import { galleryStats, profileStats } from "./stats.js";
import { queueSchedule, runEstimate, workerLoads } from "./queue-eta.js";
import { upscaleQualities } from "./upscale.js";
import { capabilityForProfile, listWorkers, workerSource } from "./workers.js";

// Whether ComfyUI runs on this machine, for the bug report.
const comfyIsLocal = () => {
  try {
    return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(comfyUrl).hostname);
  } catch {
    return false;
  }
};

/**
 * Health, service status, estimates, stats and diagnostics. `observeServices` is
 * runtime/services.ts's observer; `queue` the generation queue, for the workers its jobs wait on
 * and how long its waiting work takes.
 */
export function registerStatusRoutes(app, { observeServices, queue }) {
  app.get("/api/services/status", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const waitingWorkers = queue.store
      .jobs(ownerIdForRequest(req))
      .filter((job) => ["waiting", "starting"].includes(job.status))
      .map((job) => job.backend)
      .filter(Boolean);
    const administrator = !req.studioAccount || canAdmin(req);
    // The kind of job each worker runs now, which everyone's status summary counts.
    const jobs = new Map(queue.store.schedulable().map((job) => [job.id, job]));
    const running = new Map(
      [...queue.loads()].flatMap(([resource, load]) => {
        const job = load.current && jobs.get(load.current);
        return resource.startsWith("worker:") && job
          ? [[resource.slice("worker:".length), job.input.kind === "video" ? "video" : "image"]]
          : [];
      }),
    );
    res.json(
      await observeServices({
        allowed: ["image", "video", "text"],
        administrator,
        waitingWorkers,
        running,
        // Each worker's work and its loaded model are for administrators only.
        ...(administrator ? { loads: workerLoads(queue) } : {}),
      }),
    );
  });

  // Settings › Workers: the deployment's workers and where they come from; Studio never edits them.
  app.get("/api/workers", (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.setHeader("Cache-Control", "no-store");
    res.json({ source: workerSource(), workers: listWorkers() });
  });

  // Liveness, for the container health check and the test servers.
  app.get("/api/ping", (_req, res) => res.json({ ok: true, app: "studio", version: appVersion }));

  // Readiness: the studio can serve once its data folder is writable. ComfyUI workers may come and go
  // without taking the studio out of service, so they do not decide this.
  app.get("/api/ready", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      const probe = path.join(dataDir, `.ready-${process.pid}`);
      fs.writeFileSync(probe, "");
      fs.rmSync(probe, { force: true });
      res.json({ ok: true, ready: true });
    } catch {
      res.status(503).json({ ok: false, ready: false, error: "The data folder is not writable." });
    }
  });

  /**
   * What a generation with these settings should take here: `ms` once this model's estimates are
   * trusted, and `queueMs` when work in Studio's queue that would go before it has to finish first,
   * on whichever worker that could run it frees first. Empty when there is nothing honest to say.
   */
  directRoute(app, "GET", "/api/estimate", (_account, { query }) => {
    const upscale = upscaleQualities.includes(query.upscale) ? query.upscale : "";
    const input = {
      kind: query.kind === "video" ? "video" : "image",
      model: String(query.model || ""),
      profileId: String(query.profileId || ""),
      ...(query.profileBackend ? { profileBackend: String(query.profileBackend) } : {}),
      family: String(query.family || ""),
      width: Number(query.width) || 0,
      height: Number(query.height) || 0,
      count: Number(query.count) || 1,
      steps: Number(query.steps) || 0,
      frames: Number(query.frames) || 0,
      // What else changes the time: images it reads, and a native size's tiled decode.
      refs: Number(query.refs) || 0,
      tiledDecode: query.tiled === "1",
      ...(upscale
        ? {
            autoUpscale: {
              quality: upscale,
              faceDetail: query.faceDetail === "1",
              target: Number(query.upscaleTarget) || 0,
            },
          }
        : {}),
    };
    const now = Date.now();
    // Variations run one after another as separate runs: the first as things stand, the rest with the model loaded.
    const runs = Math.max(1, Math.min(8, Number(query.runs) || 1));
    const first = runEstimate(input, { now });
    const rest = runs > 1 ? runEstimate(input, { now, warm: true }) : 0;
    // New manual work goes before waiting background work, so only manual work is ahead of it.
    const { freeAt } = queueSchedule(queue, {
      now,
      ahead: (job) => (job.priority ?? queuePriority.manual) === queuePriority.manual,
    });
    const free = earliest(
      freeAt,
      readyWorkers(
        capabilityForProfile(input),
        profileOnBackendKey(input.profileId, input.profileBackend),
      ).map((worker) => `worker:${worker.id}`),
    );
    const queueMs = free === null ? null : Math.max(0, free - now);
    return {
      status: 200,
      payload: {
        ok: true,
        ...(first !== null && rest !== null ? { ms: first + (runs - 1) * rest } : {}),
        ...(queueMs ? { queueMs } : {}),
      },
    };
  });

  app.get("/api/stats", (req, res) => {
    res.json({
      ok: true,
      version: appVersion,
      sinceRelease: null,
      stats: galleryStats(recordsForRequest(gallery, req)),
    });
  });

  // Library › Profiles: each profile's runs, failures, stars and speed across every account.
  app.get("/api/stats/profiles", (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json({ ok: true, profiles: profileStats(visibleGallery()) });
  });

  // Versions, system and GPU for a bug report (Settings › About, and a failed card's Copy report).
  app.get("/api/diagnostics", async (_req, res) => {
    // Long enough for a busy ComfyUI, whose slow answer is often what the report is about.
    let comfyBusy = false;
    const stats = !comfyUrl
      ? null
      : await fetch(`${comfyUrl}/system_stats`, { signal: AbortSignal.timeout(10_000) }).then(
          (response) => (response.ok ? response.json() : null),
          (error) => {
            comfyBusy = isComfyTimeout(error);
            return null;
          },
        );
    const report = diagnostics({
      version: appVersion,
      stats,
      comfyBusy,
      comfyLocal: comfyIsLocal(),
    });
    res.json({ ok: true, ...report, text: diagnosticsText(report) });
  });
}
