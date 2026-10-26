import { dockerHostOnly } from "./comfy.js";
import { classifyClient } from "./client-trust.js";
import { accountSession } from "./account-store.js";

/** Who is asking, worked out once per request. */
export function clientOf(req) {
  if (!req) return { address: "", proxied: false, thisComputer: false };
  if (!req.studioClient)
    req.studioClient = classifyClient(req, {
      devToken: process.env.STUDIO_DEV_PROXY_TOKEN || "",
      hostOnly: dockerHostOnly,
    });
  return req.studioClient;
}

function accountCookie(req) {
  for (const part of String(req?.headers?.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== "studio_account") continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

/**
 * Looking after the studio: an administrator account in account mode; in single-user mode,
 * the computer Studio runs on, the only one it answers.
 */
export function canAdmin(req) {
  if (process.env.STUDIO_MULTI_USER === "1") {
    if (!req?.studioAccount && req) req.studioAccount = accountSession(accountCookie(req));
    // A personal MCP token never carries administrator authority.
    return (
      req?.studioAccount?.role === "administrator" && req.studioAccount.credential !== "mcp-token"
    );
  }
  return clientOf(req).thisComputer;
}
