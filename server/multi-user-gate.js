const publicAccountPaths = new Set([
  "/api/accounts/status",
  "/api/accounts/sign-in",
  "/api/accounts/sign-out",
  "/api/accounts/bootstrap"
]);

/** Account mode must require identity even on loopback; ordinary users stay out until stores are owner-scoped. */
export function enforceMultiUserRequest(req, res, next, { accountForRequest }) {
  if (!req.path.startsWith("/api") && !req.path.startsWith("/comfy")) return next();
  if (publicAccountPaths.has(req.path)) return next();
  const account = accountForRequest(req);
  if (!account) {
    res.setHeader("X-HEISS-Sign-In", "1");
    res.status(401).json({ ok: false, reason: "sign-in", error: "Sign in with an approved account to continue." });
    return;
  }
  if (req.path.startsWith("/comfy") && account.role !== "administrator") {
    res.status(403).json({ ok: false, error: "Raw ComfyUI access is restricted to administrators." });
    return;
  }
  if (account.role !== "administrator") {
    res.status(503).json({ ok: false, reason: "ownership-pending", error: "This account is approved, but private studio storage is not ready yet." });
    return;
  }
  next();
}
