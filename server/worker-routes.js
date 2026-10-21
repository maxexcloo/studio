import { requireAdmin } from "./route-access.js";
import { listWorkers, normalizeWorkerUrl, saveWorkers, WorkerConfigError, workerById, workerCapabilities, workersVariable } from "./workers.js";

/**
 * Settings › Workers (administrators): the list with where each worker comes
 * from, saving Studio's own workers as one change (Save & Discard), and
 * testing an address or a saved worker without changing anything. A fork
 * module beside index.js, which keeps upstream's ComfyUI routes.
 *
 * `probe(url)` asks ComfyUI at an address; `forget(id)` drops what Studio knew
 * about a worker; `refresh()` reloads the default worker's node list.
 */
export function registerWorkerRoutes(app, { probe, forget = () => {}, refresh = () => {} }) {
  const describe = () => ({
    ok: true,
    workers: listWorkers(),
    capabilities: workerCapabilities,
    deployment: { variable: workersVariable() }
  });

  app.get("/api/workers", (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.setHeader("Cache-Control", "no-store");
    res.json(describe());
  });

  app.put("/api/workers", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const before = new Map(listWorkers().map((worker) => [worker.id, JSON.stringify([worker.url, worker.capabilities])]));
    try {
      const workers = saveWorkers(req.body?.workers);
      // A worker that moved, changed what it runs or went is asked afresh.
      const after = new Map(workers.map((worker) => [worker.id, JSON.stringify([worker.url, worker.capabilities])]));
      for (const [id, value] of before) if (after.get(id) !== value) forget(id);
      refresh();
      res.json(describe());
    } catch (error) {
      res.status(error instanceof WorkerConfigError ? 400 : 500).json({ ok: false, error: error instanceof WorkerConfigError ? error.message : `Couldn’t save the workers: ${error.message}` });
    }
  });

  /** `{ id }` tests a saved worker; `{ url }` an address being typed. Nothing is saved. */
  app.post("/api/workers/test", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const saved = req.body?.id ? workerById(String(req.body.id)) : null;
    if (req.body?.id && !saved) return res.status(404).json({ ok: false, error: "That worker is no longer configured." });
    const url = saved ? saved.url : normalizeWorkerUrl(req.body?.url);
    if (!url) return res.status(400).json({ ok: false, error: "That doesn’t look like an address. Try something like 127.0.0.1:8188." });
    res.json({ ok: true, url, ...(await probe(url)) });
  });
}
