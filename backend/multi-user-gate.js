import { gatedPath } from "./gated-path.js";
import { signInHeader } from "./request-guard.js";
// Sign-in, plus the liveness and readiness probes a container platform calls without an account.
export const publicAccountPaths = new Set([
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
  ["GET", /^\/api\/(ping|models|estimate|workflows|stats|animate\/profile)$/],
  // The Library's inspiration images are shared reading; administrators curate them.
  ["GET", /^\/api\/presets(\/[\w-]+\/thumbnail)?$/],
  ["GET", /^\/api\/services\/status$/],
  ["GET", /^\/api\/accounts\/(mcp-token(\/reveal)?|me)$/],
  ["PATCH", /^\/api\/accounts\/me$/],
  ["POST", /^\/api\/accounts\/mcp-token(\/revoke)?$/],
  ["POST", /^\/api\/generate$/],
  ["GET", /^\/api\/(sessions\/[\w-]+|queue(\/[\w-]+)?|user-presets)$/],
  [
    "POST",
    /^\/api\/(sessions(\/[\w-]+\/generations)?|queue\/([\w-]+\/(cancel|clear|move|retry|swap)|sets\/[\w-]+\/move|cancel-pending|cancel-all|clear-failed|pause|resume)|user-presets)$/,
  ],
  ["PATCH", /^\/api\/user-presets\/[\w-]+$/],
  ["DELETE", /^\/api\/user-presets\/[\w-]+$/],
  ["GET", /^\/api\/jobs\/[\w-]+$/],
  ["POST", /^\/api\/jobs\/[\w-]+\/cancel$/],
  ["POST", /^\/api\/queue\/cancel$/],
  ["GET", /^\/api\/gallery(\/export|\/filters|\/jobs\/[\w-]+|\/items\/[^/]+)?$/],
  ["POST", /^\/api\/gallery\/(delete|export|favorite|frame|errors\/clear|recreate|video-edit)$/],
  ["DELETE", /^\/api\/gallery\/[^/]+$/],
  ["GET", /^\/api\/prompts$/],
  ["GET", /^\/api\/preferences$/],
  ["PATCH", /^\/api\/preferences$/],
  ["POST", /^\/api\/prompts\/(clear|enabled|forget|pin)$/],
  ["GET", /^\/api\/loras\/[^/]+$/],
  ["PUT", /^\/api\/loras\/[^/]+$/],
  ["POST", /^\/api\/loras\/library\/ops$/],
  ["GET", /^\/api\/reference-assets\/[^/]+(\/(media|thumbnail))?$/],
  ["POST", /^\/api\/reference-assets\/(upload|from-gallery)$/],
  // Character, outfit and scene cards are the requester's own, behind the Characters feature (cards.js).
  ["GET", /^\/api\/(characters|outfits|scenes)$/],
  ["POST", /^\/api\/(characters|outfits|scenes)$/],
  ["POST", /^\/api\/characters\/[\w-]+\/(generated|sheet)$/],
  ["PUT", /^\/api\/(characters|outfits|scenes)\/[\w-]+$/],
  ["DELETE", /^\/api\/(characters|outfits|scenes)\/[\w-]+$/],
  // The prompt assistant works only with the requester's profiles, LoRAs and references.
  ["GET", /^\/api\/assistant$/],
  ["POST", /^\/api\/assistant\/(animate|cards\/(describe|rate)|character|loras|negative|rewrite)$/],
  // Comparisons, the taste profile, suggestions and Dream use only the requester's own records.
  ["GET", /^\/api\/(comparisons(\/[\w-]+)?|taste|dream(\/calibration|\/discarded)?)$/],
  [
    "POST",
    /^\/api\/(comparisons(\/run)?|taste\/refresh|suggestions|dream\/(calibration|visit)|dream\/[^/]+\/(keep|discard|variations|more)|dream\/pairs\/[^/]+\/answer)$/,
  ],
  ["PUT", /^\/api\/(comparisons\/[\w-]+\/vote|taste|dream\/settings)$/],
  ["DELETE", /^\/api\/(taste|dream\/discarded)$/],
  // Dream projects are the requester's own (domain/projects.ts).
  ["GET", /^\/api\/dream\/projects$/],
  ["POST", /^\/api\/dream\/projects(\/(attach|activity)|\/[\w-]+\/undo)?$/],
  ["PUT", /^\/api\/dream\/projects\/[\w-]+$/],
  ["DELETE", /^\/api\/dream\/projects\/[\w-]+$/],
  // More Like This Set queues into the requester's own set (result-sets.js).
  ["POST", /^\/api\/result-sets\/more$/],
  ["GET", /^\/api\/(finishing|upscale\/status)$/],
  ["PUT", /^\/api\/finishing\/settings$/],
  ["POST", /^\/api\/upscale(\/cancel|\/toggle)?$/],
  ["GET", /^\/comfy\/(view|thumb|video-preview)$/],
];

export function ordinaryRouteAllowed(method, routePath) {
  const verb = method === "HEAD" ? "GET" : method;
  return ordinaryRoutes.some(([allowed, pattern]) => allowed === verb && pattern.test(routePath));
}

/**
 * Why account mode refuses `account` a gated route, as `{ status, payload }`, or null: it requires
 * identity even on loopback, and ordinary accounts reach only reviewed routes. MCP's in-process
 * calls (mcp/studio-requests.js) meet the same gate.
 */
export function multiUserRefusal(account, method, routePath) {
  if (!account)
    return {
      status: 401,
      payload: {
        ok: false,
        reason: "sign-in",
        error: "Sign in with an approved account to continue.",
      },
    };
  if (account.role === "administrator") return null;
  if (ordinaryRouteAllowed(String(method || "GET").toUpperCase(), routePath)) return null;
  return {
    status: 403,
    payload: {
      ok: false,
      reason: "administrator",
      error: routePath.startsWith("/comfy")
        ? "Raw ComfyUI access is restricted to administrators."
        : "This action is restricted to administrators.",
    },
  };
}

export function enforceMultiUserRequest(req, res, next, { accountForRequest }) {
  if (!gatedPath(req.path) || publicAccountPaths.has(req.path)) return next();
  const refusal = multiUserRefusal(accountForRequest(req), req.method, req.path);
  if (!refusal) return next();
  if (refusal.status === 401) res.setHeader(signInHeader, "1");
  res.status(refusal.status).json(refusal.payload);
}
