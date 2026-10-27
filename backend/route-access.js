import { canAdmin, clientOf } from "./access.js";

import { multiUserEnabled } from "./multi-user-auth.js";

/** This computer in single-user mode; an administrator in account mode. */
export function requireLocal(req, res) {
  if (multiUserEnabled) {
    if (canAdmin(req)) return true;
    res.status(403).json({ ok: false, error: "This action is restricted to administrators." });
    return false;
  }
  if (clientOf(req).thisComputer) return true;
  res.status(403).json({ ok: false, error: "Only this computer can do this." });
  return false;
}

/**
 * Looking after the computer (model downloads, workers, the output folder
 * and workflow files) happens at that computer, or by an administrator in
 * account mode.
 * Anywhere else the server refuses them and the app hides them.
 */
export function requireAdmin(req, res) {
  if (canAdmin(req)) return true;
  res.status(403).json({
    ok: false,
    reason: "computer-only",
    error: "Do this on the computer running Studio, or as an administrator.",
  });
  return false;
}

/**
 * Whether an administrator's request came from chat: MCP's admin tools (mcp-admin.js) call the same
 * routes as the UI with MCP's administrator credential, so imports, catalogue edits and profile
 * versions record their origin as chat.
 */
export function fromChat(req) {
  return req?.studioAccount?.credential === "mcp-admin";
}
