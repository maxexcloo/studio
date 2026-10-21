import { canAdmin, clientOf, deviceSession } from './access.js';

import { multiUserEnabled } from './multi-user-auth.js';

/** This computer, or another device that signed in (the gate below has already checked). */
export function requireLocal(req, res) {
  if (multiUserEnabled) {
    if (canAdmin(req)) return true;
    res.status(403).json({ ok: false, error: "This action is restricted to administrators." });
    return false;
  }
  const client = clientOf(req);
  if (client.thisComputer || (client.network && deviceSession(req))) return true;
  res.status(403).json({ ok: false, error: "Only this computer or a signed-in device can do this." });
  return false;
}

/**
 * Looking after the computer (model folders and downloads, node installs,
 * ComfyUI's address and restarts, the output folder, updates and workflow
 * files) happens at that computer. A signed-in device may too
 * when the owner turned on "Trust other devices with admin" (access.js).
 * Anywhere else the server refuses them and the app hides them.
 */
export function requireAdmin(req, res) {
  if (canAdmin(req)) return true;
  res.status(403).json({ ok: false, reason: "computer-only", error: "Do this on the computer running Studio. Other devices can be allowed in Settings › Connection." });
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
