import { ownerIdForRequest } from "../account-ownership.js";
import { optionsFor } from "../comfy/comfy.js";
import { accountMayUseLoras, loraAllowed } from "../model/catalogue.js";
import { requireLocal } from "../route-access.js";
import { loraInfos } from "./info.js";
import {
  applyLoraOps,
  clearLoraState,
  loadLoraLibrary,
  loadLoraStack,
  saveLoraLibrary,
  saveLoraStack,
} from "./stacks.js";

/**
 * An account's LoRA library and per-workflow stacks, and what each installed LoRA was trained for.
 * Registered after the gallery's /api/loras/previews, which /api/loras/:workflowId would match.
 */
export function registerLoraRoutes(app, { comfyDownMessage, loadComfyContext }) {
  app.delete("/api/loras", (req, res) => {
    if (!requireLocal(req, res)) return;
    clearLoraState(ownerIdForRequest(req));
    res.json({ ok: true });
  });

  app.get("/api/loras/library", (req, res) => {
    if (!accountMayUseLoras(req))
      return res.json({ found: false, library: { strengths: {}, snapshots: {} } });
    const library = loadLoraLibrary(ownerIdForRequest(req));
    res.json({ found: library !== null, library: library || { strengths: {}, snapshots: {} } });
  });

  app.put("/api/loras/library", (req, res) => {
    if (!accountMayUseLoras(req))
      return res
        .status(403)
        .json({ ok: false, error: "LoRA access is disabled for this account." });
    try {
      res.json({ ok: true, library: saveLoraLibrary(req.body?.library, ownerIdForRequest(req)) });
    } catch (error) {
      res
        .status(500)
        .json({ ok: false, error: `Couldn’t save the LoRA library: ${error.message}` });
    }
  });

  // Clients send edits, not whole copies, so two devices never overwrite each other.
  app.post("/api/loras/library/ops", (req, res) => {
    if (!accountMayUseLoras(req))
      return res
        .status(403)
        .json({ ok: false, error: "LoRA access is disabled for this account." });
    try {
      res.json({ ok: true, library: applyLoraOps(req.body?.ops, ownerIdForRequest(req)) });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  // What each LoRA ComfyUI lists was trained for and its trigger words, from the files themselves.
  app.get("/api/loras/info", async (req, res) => {
    if (!accountMayUseLoras(req)) return res.json({ ok: true, loras: {} });
    try {
      const { info } = await loadComfyContext();
      const names = optionsFor(info, "LoraLoader", "lora_name").filter(
        loraAllowed(req.studioAccount),
      );
      res.json({ ok: true, loras: await loraInfos(names) });
    } catch (error) {
      res.status(503).json({ ok: false, loras: {}, error: comfyDownMessage(error?.message) });
    }
  });

  app.get("/api/loras/:workflowId", (req, res) => {
    if (!accountMayUseLoras(req)) return res.json({ found: false, loras: [] });
    const loras = loadLoraStack(req.params.workflowId, ownerIdForRequest(req));
    res.json({ found: loras !== null, loras: loras || [] });
  });

  app.put("/api/loras/:workflowId", (req, res) => {
    if (!accountMayUseLoras(req))
      return res
        .status(403)
        .json({ ok: false, error: "LoRA access is disabled for this account." });
    try {
      res.json({
        ok: true,
        loras: saveLoraStack(req.params.workflowId, req.body?.loras, ownerIdForRequest(req)),
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });
}
