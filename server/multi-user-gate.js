import { gatedPath } from "./gated-path.js";
import { signInHeader } from "./request-guard.js";
// Sign-in, plus the liveness and readiness probes a container platform calls without an account.
const publicAccountPaths = new Set([
  "/api/ping",
  "/api/ready",
  "/api/accounts/status",
  "/api/accounts/sign-in",
  "/api/accounts/sign-out",
  "/api/accounts/bootstrap",
  "/api/accounts/oidc/start",
  "/api/accounts/oidc/callback",
]);

/**
 * What an ordinary account may reach. Every route here is owner-scoped or
 * reveals nothing private; anything else stays administrator-only, so a new
 * route is closed to ordinary accounts until it is reviewed and added.
 */
const ordinaryRoutes = [
  ["GET", /^\/api\/(ping|health|models|estimate|workflows|stats|paths)$/],
  ["GET", /^\/api\/comfy\/status$/],
  ["GET", /^\/api\/accounts\/(mcp-token|me)$/],
  ["PATCH", /^\/api\/accounts\/me$/],
  ["POST", /^\/api\/accounts\/mcp-token(\/revoke)?$/],
  ["POST", /^\/api\/generate$/],
  ["GET", /^\/api\/(sessions(\/[\w-]+)?|queue|user-presets)$/],
  [
    "POST",
    /^\/api\/(sessions(\/[\w-]+\/generations)?|queue\/([\w-]+\/(cancel|retry)|cancel-pending)|user-presets)$/,
  ],
  ["PATCH", /^\/api\/(sessions|user-presets)\/[\w-]+$/],
  ["DELETE", /^\/api\/user-presets\/[\w-]+$/],
  ["GET", /^\/api\/jobs\/[\w-]+$/],
  ["POST", /^\/api\/jobs\/[\w-]+\/cancel$/],
  ["POST", /^\/api\/queue\/cancel$/],
  ["GET", /^\/api\/gallery(\/delta|\/export|\/jobs\/[\w-]+)?$/],
  ["POST", /^\/api\/gallery\/(favorite|errors\/clear)$/],
  ["DELETE", /^\/api\/gallery\/[^/]+$/],
  ["GET", /^\/api\/chat$/],
  ["GET", /^\/api\/chat\/status$/],
  ["GET", /^\/api\/sessions\/[\w-]+\/chat$/],
  ["POST", /^\/api\/sessions\/[\w-]+\/chat$/],
  ["POST", /^\/api\/chat\/handover$/],
  ["GET", /^\/api\/prompts$/],
  ["POST", /^\/api\/prompts\/(clear|enabled|forget|pin)$/],
  ["GET", /^\/api\/loras\/[^/]+$/],
  ["PUT", /^\/api\/loras\/[^/]+$/],
  ["POST", /^\/api\/loras\/library\/ops$/],
  ["GET", /^\/api\/reference-assets(\/[^/]+(\/[a-z-]+)?)?$/],
  ["POST", /^\/api\/reference-assets\/(upload|from-gallery)$/],
  ["DELETE", /^\/api\/reference-assets\/[^/]+$/],
  ["GET", /^\/api\/upscale\/status$/],
  ["POST", /^\/api\/upscale(\/cancel|\/toggle)?$/],
  ["GET", /^\/comfy\/(view|thumb|video-preview)$/],
];

export function ordinaryRouteAllowed(method, routePath) {
  const verb = method === "HEAD" ? "GET" : method;
  return ordinaryRoutes.some(([allowed, pattern]) => allowed === verb && pattern.test(routePath));
}

/** Account mode requires identity even on loopback; ordinary accounts reach only reviewed routes. */
export function enforceMultiUserRequest(req, res, next, { accountForRequest }) {
  if (!gatedPath(req.path)) return next();
  if (publicAccountPaths.has(req.path)) return next();
  const account = accountForRequest(req);
  if (!account) {
    res.setHeader(signInHeader, "1");
    res.status(401).json({
      ok: false,
      reason: "sign-in",
      error: "Sign in with an approved account to continue.",
    });
    return;
  }
  if (account.role === "administrator") return next();
  if (ordinaryRouteAllowed(String(req.method || "GET").toUpperCase(), req.path)) return next();
  res.status(403).json({
    ok: false,
    reason: "administrator",
    error: req.path.startsWith("/comfy")
      ? "Raw ComfyUI access is restricted to administrators."
      : "This action is restricted to administrators.",
  });
}
