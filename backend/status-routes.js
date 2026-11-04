import fs from "node:fs";
import path from "node:path";
import { canAdmin } from "./access.js";
import { ownerIdForRequest, recordsForRequest } from "./account-ownership.js";
import { profileOnBackendKey, routeJob } from "./comfy/backends.js";
import { comfyUrl, isComfyTimeout } from "./comfy/comfy.js";
import { appVersion } from "./data-dir.js";
import { diagnostics, diagnosticsText } from "./diagnostics.js";
import { dataDir, filterVisibleGallery, gallery } from "./gallery/store.js";
import { queueClearsAt } from "./jobs.js";
import { requireAdmin } from "./route-access.js";
import { galleryStats, profileStats } from "./stats.js";
import { generationEstimate, upscaleEstimate } from "./timings.js";
import { upscaleWork } from "./upscale-timing.js";
import { upscalePlan, upscaleQualities } from "./upscale.js";
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
 * runtime/services.ts's observer; `store` the queue, for the workers its jobs wait on.
 */
export function registerStatusRoutes(app, { observeServices, store }) {
  app.get("/api/services/status", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const waitingWorkers = store
      .jobs(ownerIdForRequest(req))
      .filter((job) => ["waiting", "starting"].includes(job.status))
      .map((job) => job.backend || job.input.backendId)
      .filter(Boolean);
    res.json(
      await observeServices({
        allowed: ["image", "video", "text"],
        administrator: !req.studioAccount || canAdmin(req),
        waitingWorkers,
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
   * What a generation with these settings should take here, for the composer:
   * `ms` once this model's estimates are trusted, and `queueMs` when Studio's own
   * queue has to finish first. Empty when there is nothing honest to say.
   */
  app.get("/api/estimate", (req, res) => {
    const query = req.query || {};
    const body = {
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
    };
    const now = Date.now();
    const estimate = generationEstimate(body, { now });
    // Variations run one after another as separate runs: the first as things stand, the rest with the model loaded.
    const runs = Math.max(1, Math.min(8, Number(query.runs) || 1));
    const rest = runs > 1 ? generationEstimate(body, { now, warm: true }) : null;
    // Smart upscale is part of each run: its time, from the upscales this machine has made, is added to every one.
    const upscaleQuality =
      body.kind === "image" && upscaleQualities.includes(query.upscale) ? query.upscale : "";
    const plan = upscaleQuality
      ? upscalePlan({
          width: body.width,
          height: body.height,
          quality: upscaleQuality,
          target: Number(query.upscaleTarget) || 0,
        })
      : null;
    const upscale = plan
      ? upscaleEstimate({
          quality: upscaleQuality,
          faceDetail: query.faceDetail === "1",
          work: upscaleWork({
            width: plan.estimatedWidth,
            height: plan.estimatedHeight,
            count: body.count,
          }),
        })
      : null;
    const trusted =
      estimate?.trusted && (runs === 1 || rest?.trusted) && (!plan || upscale?.trusted);
    const backend =
      routeJob(capabilityForProfile(body), {
        profileId: profileOnBackendKey(body.profileId, body.profileBackend),
      })?.id || "";
    const clears = backend ? queueClearsAt(now, backend) : null;
    const queueMs = clears === null ? null : Math.max(0, clears - now);
    const upscaleMs = upscale?.totalMs || 0;
    res.json({
      ok: true,
      ...(trusted
        ? { ms: estimate.totalMs + upscaleMs + (runs - 1) * ((rest?.totalMs || 0) + upscaleMs) }
        : {}),
      ...(queueMs ? { queueMs } : {}),
    });
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
    res.json({ ok: true, profiles: profileStats(filterVisibleGallery(gallery)) });
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
