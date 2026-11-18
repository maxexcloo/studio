import { catalogueDownload } from "../catalogue-downloads.js";
import { directRoute } from "../domain/direct-route.ts";
import { libraryDownload } from "../library/downloads.js";
import { adminRefusal } from "../route-access.js";
import { refreshWorkerModels } from "../worker-models.js";
import { defaultWorkerId } from "../workers.js";
import { cancelDownload, discardDownload, downloadState, startDownload } from "./downloads.js";

export function registerModelDownloadRoutes(app, { loadComfyContext }) {
  // Every downloads answer starts from the worker's current files, or its last known ones while
  // ComfyUI is parked; writing into its model library still needs it running.
  const route = (method, path, run) =>
    directRoute(app, method, path, async (account, input) => {
      const reachable = await refreshWorkerModels()
        .then(() => true)
        .catch(() => false);
      return run(account, input, reachable);
    });
  const unreachable = {
    status: 409,
    payload: {
      ok: false,
      error:
        "ComfyUI isn't running, so it can't receive downloads. Start it in Settings › Workers.",
    },
  };

  route("GET", "/api/models/downloads", () => ({
    status: 200,
    payload: { ok: true, ...downloadState() },
  }));

  // Catalogue files and provider previews resolved on the server are accepted
  // by ID; this route never accepts a browser-supplied download address.
  route("POST", "/api/models/downloads", async (account, { body }, reachable) => {
    const refused = adminRefusal(account);
    if (refused) return refused;
    if (!reachable) return unreachable;
    const spec = catalogueDownload(body?.id) || libraryDownload(String(body?.id || ""));
    if (!spec) return { status: 400, payload: { ok: false, error: "Unknown file." } };
    try {
      const download = await startDownload(spec);
      // Already on disk: rescan now so the model page catches up without another click.
      if (download?.already)
        await loadComfyContext(defaultWorkerId(), { force: true }).catch(() => null);
      return { status: 200, payload: { ok: true, download, ...downloadState() } };
    } catch (error) {
      return { status: 400, payload: { ok: false, error: error.message } };
    }
  });

  route("POST", "/api/models/downloads/cancel", async (account, { body }, reachable) => {
    const refused = adminRefusal(account);
    if (refused) return refused;
    const id = String(body?.id || "");
    const spec = body?.discard ? catalogueDownload(id) || libraryDownload(id) : null;
    if (spec && !reachable) return unreachable;
    try {
      if (spec) await discardDownload(spec);
      else cancelDownload(id);
      return { status: 200, payload: { ok: true, ...downloadState() } };
    } catch (error) {
      return { status: 400, payload: { ok: false, error: error.message } };
    }
  });
}
