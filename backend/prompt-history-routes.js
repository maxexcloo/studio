import { ownerIdForRequest } from "./account-ownership.js";
import {
  clearPromptHistory,
  forgetPrompts,
  listPrompts,
  promptHistoryEnabled,
  setPromptHistoryEnabled,
  setPromptPinned,
} from "./prompt-history.js";

/** Each account's prompt history (prompt-history.js): list, pin, forget and clear. */
export function registerPromptHistoryRoutes(app) {
  app.get("/api/prompts", (req, res) => {
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    const ownerId = ownerIdForRequest(req);
    res.json({
      prompts: listPrompts(req.query.kind, ownerId),
      enabled: promptHistoryEnabled(req.query.kind, ownerId),
    });
  });

  app.post("/api/prompts/enabled", (req, res) => {
    const ownerId = ownerIdForRequest(req);
    const prompts = setPromptHistoryEnabled(req.body?.enabled !== false, ownerId);
    res.json({ ok: true, prompts, enabled: promptHistoryEnabled("positive", ownerId) });
  });

  app.post("/api/prompts/pin", (req, res) => {
    res.json({
      ok: true,
      prompts: setPromptPinned(
        String(req.body?.text || ""),
        Boolean(req.body?.pinned),
        req.body?.kind,
        ownerIdForRequest(req),
      ),
    });
  });

  app.post("/api/prompts/forget", (req, res) => {
    res.json({
      ok: true,
      prompts: forgetPrompts(
        [String(req.body?.text || "")],
        new Set(),
        req.body?.kind,
        ownerIdForRequest(req),
      ),
    });
  });

  app.post("/api/prompts/clear", (req, res) => {
    res.json({
      ok: true,
      prompts: clearPromptHistory(
        { keepPinned: req.body?.keepPinned !== false },
        req.body?.kind,
        ownerIdForRequest(req),
      ),
    });
  });
}
