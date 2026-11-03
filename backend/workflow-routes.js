import { canAdmin } from "./access.js";
import { mayUseGenerationProfile } from "./account-policy.js";
import { comfyUrl, demoMode } from "./comfy/comfy.js";
import { deleteImportedWorkflow, saveImportedWorkflow } from "./custom-workflows.js";
import { inferModels, mockModelResult, offlineModelResult } from "./model/models.js";
import { requireAdmin } from "./route-access.js";
import {
  loadWorkflowPreferences,
  previewWorkflowImport,
  saveWorkflowPreferences,
  workflowSummaries,
} from "./workflow-catalog.js";

/** The workflow list, imports and their removal. `loadComfyContext` is model/catalogue.js's. */
export function registerWorkflowRoutes(app, { loadComfyContext }) {
  /** Ordinary accounts see only their permitted workflows, without server paths or delete handles. */
  function workflowsForRequest(req, workflows) {
    if (!req.studioAccount || canAdmin(req)) return workflows;
    return workflows
      .filter((item) =>
        mayUseGenerationProfile(req.studioAccount, {
          id: item.profileId,
          family: item.family,
          uncensored: item.uncensored,
          aiDrafted: item.aiDrafted,
        }),
      )
      .map(({ path: _path, deleteId: _deleteId, ...item }) => item);
  }

  app.get("/api/workflows", async (req, res) => {
    try {
      const { info, stats } = await loadComfyContext().catch(() => ({ info: {}, stats: {} }));
      const models = Object.keys(info || {}).length
        ? inferModels(info, stats)
        : demoMode
          ? mockModelResult()
          : offlineModelResult(comfyUrl);
      const preferences = loadWorkflowPreferences();
      res.json({
        workflows: workflowsForRequest(
          req,
          workflowSummaries({ info, profiles: models.profiles, preferences }),
        ),
        preferences,
      });
    } catch {
      const models = demoMode ? mockModelResult() : offlineModelResult(comfyUrl);
      const preferences = loadWorkflowPreferences();
      res.json({
        workflows: workflowsForRequest(
          req,
          workflowSummaries({ info: {}, profiles: models.profiles, preferences }),
        ),
        preferences,
      });
    }
  });

  app.post("/api/workflows/import/preview", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const raw = req.body?.workflow || req.body;
      const { info } = await loadComfyContext().catch(() => ({ info: {} }));
      res.json({ ok: true, preview: previewWorkflowImport(raw, req.body?.filename || "", info) });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/workflows/import", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const raw = req.body?.workflow || req.body;
      const { info } = await loadComfyContext().catch(() => ({ info: {} }));
      // The review's own notes (the node list, what was guessed) aren't part of the workflow.
      const { nodes: _nodes, guessed: _guessed, ...metadata } = req.body?.metadata || {};
      const normalized =
        (Array.isArray(raw?.nodes) && Array.isArray(raw?.links)) || raw?.prompt
          ? {
              graph: previewWorkflowImport(raw, req.body?.filename || "", info).graph,
              studio: metadata,
            }
          : raw;
      const workflow = saveImportedWorkflow(normalized, metadata);
      const { graph: _graph, ...summary } = workflow;
      res.json({ ok: true, workflow: summary });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.delete("/api/workflows/:id", (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const result = deleteImportedWorkflow(req.params.id.replace(/^custom:/, ""));
      const preferences = loadWorkflowPreferences();
      preferences.favorites = preferences.favorites.filter(
        (id) => id !== `custom:${result.id}` && id !== result.id,
      );
      delete preferences.lastUsed[`custom:${result.id}`];
      saveWorkflowPreferences(preferences);
      res.json(result);
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });
}
