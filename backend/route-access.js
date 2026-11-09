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
 * requireLocal and requireAdmin for a shared route's account (domain/direct-route.ts): the refusal
 * to answer, or null. Single-user mode answers only this computer before any route runs, and
 * a personal MCP token never carries administrator authority.
 */
export function localRefusal(account) {
  if (adminAccount(account)) return null;
  return {
    status: 403,
    payload: { ok: false, error: "This action is restricted to administrators." },
  };
}
export function adminRefusal(account) {
  if (adminAccount(account)) return null;
  return {
    status: 403,
    payload: {
      ok: false,
      reason: "computer-only",
      error: "Do this on the computer running Studio, or as an administrator.",
    },
  };
}
function adminAccount(account) {
  return (
    !multiUserEnabled || (account?.role === "administrator" && account.credential !== "mcp-token")
  );
}

/**
 * Whether an administrator's call came from chat: MCP's admin tools (mcp/admin.js) call the same
 * routes as the UI as MCP's administrator, so imports, catalogue edits and profile versions record
 * their origin as chat.
 */
export function fromChat(account) {
  return account?.credential === "mcp-admin";
}
