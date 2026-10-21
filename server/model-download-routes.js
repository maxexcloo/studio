import { refreshWorkerModels, remoteModelsEnabled } from './worker-models.js';
import { comfyUrl } from './comfy.js';
import { catalogDownload } from './family-profiles.js';
import { cancelDownload, discardDownload, downloadState, replaceDownload, startDownload } from './model-downloads.js';
import { hfEndpoint, hfTokenStatus, saveHfToken } from './hf-access.js';
import { describeHardware } from './hardware.js';
import { starterPlan } from './starter-models.js';
import { requireAdmin } from "./route-access.js";
import { libraryDownload } from './library-downloads.js';
import { clearImportedManifest, importManifest, loadManifest, manifestStatus, restoreMissing, startVerify } from './model-manifest.js';

export function registerModelDownloadRoutes(app, { loadComfyContext }) {
  app.use('/api/models/manifest', (req, res, next) => {
    if (!requireAdmin(req, res)) return;
    if (remoteModelsEnabled()) return res.status(409).json({ ok: false, error: 'Manifest import, verification and restore require local model storage. Worker mode manages the active library through Downloads.' });
    next();
  });
  app.use('/api/models/downloads', async (req, res, next) => {
    try { await refreshWorkerModels(); next(); }
    catch (error) { res.status(503).json({ ok: false, error: error.message }); }
  });
  // The pinned model manifest (model-manifest.js): administrators only, like every model change.
  app.get("/api/models/manifest", (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, ...manifestStatus() });
  });
  app.get("/api/models/manifest/export", (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.setHeader("Content-Disposition", 'attachment; filename="models.json"');
    res.json(loadManifest().entries);
  });
  app.post("/api/models/manifest", (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      if (req.body?.reset === true) { clearImportedManifest(); return res.json({ ok: true, ...manifestStatus() }); }
      importManifest(Array.isArray(req.body) ? req.body : req.body?.entries);
      res.json({ ok: true, ...manifestStatus() });
    } catch (error) { res.status(400).json({ ok: false, error: error.message }); }
  });
  app.post("/api/models/manifest/verify", (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json({ ok: true, verify: startVerify({ all: req.body?.all === true }) });
  });
  app.post("/api/models/manifest/restore", (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json({ ok: true, ...restoreMissing(Array.isArray(req.body?.paths) ? req.body.paths : null) });
  });

  app.get("/api/models/downloads", (_req, res) => {
    res.json({ ok: true, ...downloadState() });
  });

  // Catalogue files and provider previews resolved on the server are accepted
  // by ID; this route never accepts a browser-supplied download address.
  app.post("/api/models/downloads", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const spec = catalogDownload(req.body?.id) || libraryDownload(String(req.body?.id || ''));
    if (!spec) {
      res.status(400).json({ ok: false, error: "Unknown file." });
      return;
    }
    try {
      const download = await startDownload(spec);
      // Already on disk: rescan now so the model page catches up without another click.
      if (download?.already) await loadComfyContext({ force: true }).catch(() => null);
      res.json({ ok: true, download, ...downloadState() });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  // First models for an empty studio, sized for this hardware. Their files are
  // ordinary catalog downloads, fetched through the route above.
  app.get("/api/starter-models", async (_req, res) => {
    const context = await loadComfyContext().catch(() => null);
    const hardware = await describeHardware({ stats: context?.stats, comfyUrl });
    res.json({ ok: true, hardware, local: downloadState().local, families: starterPlan({ hardware, info: context?.info }) });
  });

  app.post("/api/models/downloads/cancel", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = String(req.body?.id || "");
    const spec = req.body?.discard ? catalogDownload(id) || libraryDownload(id) : null;
    try {
      if (spec) await discardDownload(spec);
      else cancelDownload(id);
      res.json({ ok: true, ...downloadState() });
    } catch (error) { res.status(400).json({ ok: false, error: error.message }); }
  });

  // A Hugging Face token for gated downloads: kept in .env, only ever sent to huggingface.co, never shown back.
  app.get("/api/settings/hf-token", (_req, res) => {
    res.json({ ok: true, ...hfTokenStatus(), mirror: hfEndpoint()?.origin || "" });
  });

  app.post("/api/settings/hf-token", (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      res.json({ ok: true, ...saveHfToken(req.body?.token), mirror: hfEndpoint()?.origin || "" });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  // "Download again" for a catalog file a run found damaged: the broken copy goes first.
  app.post("/api/models/downloads/replace", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const spec = catalogDownload(req.body?.id);
    if (!spec) {
      res.status(400).json({ ok: false, error: "Unknown file." });
      return;
    }
    try {
      res.json({ ok: true, download: await replaceDownload(spec), ...downloadState() });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });
}
