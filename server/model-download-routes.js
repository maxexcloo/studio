import { comfyUrl } from './comfy.js';
import { catalogDownload } from './family-profiles.js';
import { cancelDownload, discardDownload, downloadState, replaceDownload, startDownload } from './model-downloads.js';
import { hfEndpoint, hfTokenStatus, saveHfToken } from './hf-access.js';
import { describeHardware } from './hardware.js';
import { starterPlan } from './starter-models.js';
import { requireAdmin } from "./route-access.js";
import { libraryDownload } from './library-downloads.js';

export function registerModelDownloadRoutes(app, { loadComfyContext }) {
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
      const download = startDownload(spec);
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

  app.post("/api/models/downloads/cancel", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = String(req.body?.id || "");
    const spec = req.body?.discard ? catalogDownload(id) || libraryDownload(id) : null;
    if (spec) discardDownload(spec);
    else cancelDownload(id);
    res.json({ ok: true, ...downloadState() });
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
  app.post("/api/models/downloads/replace", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const spec = catalogDownload(req.body?.id);
    if (!spec) {
      res.status(400).json({ ok: false, error: "Unknown file." });
      return;
    }
    try {
      res.json({ ok: true, download: replaceDownload(spec), ...downloadState() });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });
}
