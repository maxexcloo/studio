import { refreshWorkerModels } from "./worker-models.js";
import { catalogDownload } from "./catalog-downloads.js";
import {
  cancelDownload,
  discardDownload,
  downloadState,
  startDownload,
} from "./model-downloads.js";
import { requireAdmin } from "./route-access.js";
import { libraryDownload } from "./library-downloads.js";

export function registerModelDownloadRoutes(app, { loadComfyContext }) {
  app.use("/api/models/downloads", async (req, res, next) => {
    try {
      await refreshWorkerModels();
      next();
    } catch (error) {
      res.status(503).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/models/downloads", (_req, res) => {
    res.json({ ok: true, ...downloadState() });
  });

  // Catalogue files and provider previews resolved on the server are accepted
  // by ID; this route never accepts a browser-supplied download address.
  app.post("/api/models/downloads", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const spec = catalogDownload(req.body?.id) || libraryDownload(String(req.body?.id || ""));
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

  app.post("/api/models/downloads/cancel", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = String(req.body?.id || "");
    const spec = req.body?.discard ? catalogDownload(id) || libraryDownload(id) : null;
    try {
      if (spec) await discardDownload(spec);
      else cancelDownload(id);
      res.json({ ok: true, ...downloadState() });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });
}
