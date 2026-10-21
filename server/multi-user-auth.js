import crypto from "node:crypto";
import { accountAccessForId, ownAccount, updateOwnAccount, validateOwnAccountChange, wrongCurrentPassword, dismissGatewayIdentity, listGatewayIdentities, setGatewayLink, signInWithOidcIdentity, accountMcpTokenStatus, accountSession, accountStoreSnapshot, assignAccessProfile, createAccountSession, createLocalAccount, defaultAccessProfileId, requireApproval, setRequireApproval, ensureBuiltInAccessProfiles, listAccessProfiles, setDefaultAccessProfile, listAccounts, migrateCloudModelAccess, revokeAccountMcpToken, revokeAccountSession, rotateAccountMcpToken, saveAccessProfile, setAccountDisabled, verifyAccountMcpToken, verifyLocalAccount } from "./account-store.js";
import { canAdmin, clientOf, endDeviceSession } from "./access.js";
import { grokEnabled, lorasEnabled, presetsEnabled } from "./features.js";
import { createGuessLimiter, waitWords } from "./guess-limit.js";
import { createOidcClient, oidcConfigFromEnv } from "./oidc.js";

export const multiUserEnabled = process.env.STUDIO_MULTI_USER === "1";
export const accountCookieName = "studio_account";
const oidcStateCookie = `${accountCookieName}_oidc`;
const limiter = createGuessLimiter();

function cookieToken(req, name = accountCookieName) {
  for (const part of String(req?.headers?.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return ""; }
  }
  return "";
}

// Personal MCP tokens reach only the routes MCP itself calls, never account or studio administration.
const mcpBearerRoutes = [
  ["GET", /^\/api\/models$/],
  ["GET", /^\/api\/loras\/info$/],
  ["POST", /^\/api\/generate$/],
  ["GET", /^\/api\/jobs\/[\w-]+$/],
  ["GET", /^\/api\/gallery\/jobs\/[\w-]+$/],
  ["POST", /^\/api\/reference-assets\/upload$/],
  ["GET", /^\/comfy\/view$/]
];

export function mcpBearerRouteAllowed(method, routePath) {
  return mcpBearerRoutes.some(([allowedMethod, pattern]) => allowedMethod === method && pattern.test(routePath));
}

// MCP's own loopback calls for gateway-linked accounts carry this per-process credential, never a stored token.
const internalSecret = crypto.randomBytes(32).toString("base64url");
export function internalMcpHeaders(accountId) {
  return { "X-Studio-Mcp-Internal": internalSecret, "X-Studio-Mcp-Account": String(accountId || "") };
}

function internalMcpAccount(req, method, routePath) {
  const given = String(req?.headers?.["x-studio-mcp-internal"] || "");
  if (!given || Buffer.byteLength(given) !== Buffer.byteLength(internalSecret) || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(internalSecret))) return null;
  if (!clientOf(req).thisComputer || !mcpBearerRouteAllowed(method, routePath)) return null;
  const access = accountAccessForId(String(req.headers["x-studio-mcp-account"] || ""));
  return access?.authenticated ? { ...access, credential: "mcp-token" } : null;
}

export function accountForRequest(req) {
  if (req?.heissAccount !== undefined) return req.heissAccount;
  const bearer = /^Bearer ([^\s]+)$/i.exec(String(req?.headers?.authorization || ""))?.[1] || "";
  const routePath = String(req?.path || req?.url || "").split("?")[0];
  const method = String(req?.method || "GET").toUpperCase();
  const account = accountSession(cookieToken(req))
    || (bearer && mcpBearerRouteAllowed(method, routePath) ? verifyAccountMcpToken(bearer) : null)
    || internalMcpAccount(req, method, routePath);
  if (req) req.heissAccount = account;
  return account;
}

function appendCookie(res, cookie) {
  const current = res.getHeader?.("Set-Cookie") ?? res.headers?.["Set-Cookie"];
  res.setHeader("Set-Cookie", [].concat(current || [], cookie));
}

// Behind a TLS-terminating proxy the socket is plain HTTP; a forged header only affects its sender.
function secureRequest(req) {
  return Boolean(req?.socket?.encrypted)
    || String(req?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase() === "https";
}

function accountCookie(req, value, maxAge = 0) {
  return [`${accountCookieName}=${value}`, "Path=/", `Max-Age=${maxAge}`, "HttpOnly", "SameSite=Strict", ...(secureRequest(req) ? ["Secure"] : [])].join("; ");
}

function publicStatus(req) {
  if (!multiUserEnabled) return { ok: true, mode: "single-user" };
  const account = accountForRequest(req);
  return {
    ok: true,
    mode: "multi-user",
    signedIn: Boolean(account),
    account: account ? { id: account.userId, role: account.role, generationProfiles: account.generationProfiles, features: account.features } : null,
    needsRecoveryAdmin: accountStoreSnapshot().accounts.length === 0,
    ...(accountStoreSnapshot().accounts.length === 0 && setupTokenUsable() ? { setupTokenAccepted: true } : {}),
    ...(oidc ? { oidc: { label: oidc.label } } : {})
  };
}

function requireAccountAdmin(req, res) {
  if (multiUserEnabled && canAdmin(req)) return true;
  res.status(multiUserEnabled ? 403 : 404).json({ ok: false, error: multiUserEnabled ? "Administrator access is required." : "Account management is disabled." });
  return false;
}

let oidc = null;
/** A setup token shorter than 32 characters stops Studio instead of being ignored. */
export function checkSetupToken(value = process.env.STUDIO_SETUP_TOKEN) {
  if (value && String(value).length < 32) throw new Error("STUDIO_SETUP_TOKEN must be at least 32 characters.");
}
const setupTokenUsable = () => String(process.env.STUDIO_SETUP_TOKEN || "").length >= 32;
if (multiUserEnabled) checkSetupToken();

/**
 * `availableProfiles` lists the grantable local profile ids; `cloudProfiles` the cloud ones,
 * which access profiles grant through their Cloud Models feature instead.
 */
export function registerMultiUserAuthRoutes(app, { availableProfiles = async () => [], cloudProfiles = async () => [], oidcClient } = {}) {
  oidc = oidcClient !== undefined ? oidcClient : multiUserEnabled && oidcConfigFromEnv() ? createOidcClient(oidcConfigFromEnv()) : null;
  // Single-user mode answers only the status route, even if an old account store remains.
  const route = (method) => (path, handler) => app[method](path, (req, res) => (multiUserEnabled || path === "/api/accounts/status"
    ? handler(req, res)
    : res.status(404).json({ ok: false, error: "Accounts are disabled." })));
  const [get, post, patch] = ["get", "post", "patch"].map(route);
  let bootstrapping = null;

  get("/api/accounts/status", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(publicStatus(req));
  });

  post("/api/accounts/bootstrap", async (req, res) => {
    if (!multiUserEnabled || accountStoreSnapshot().accounts.length) {
      res.status(409).json({ ok: false, error: "Recovery administrator setup is already complete." });
      return;
    }
    // Where nobody can sit at the computer (a container platform), a one-time setup token from the environment stands in.
    const setupToken = process.env.STUDIO_SETUP_TOKEN || "";
    const given = String(req.body?.setupToken || "");
    const tokenMatches = setupToken.length >= 32 && Buffer.byteLength(given) === Buffer.byteLength(setupToken) && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(setupToken));
    if (!clientOf(req).thisComputer && !tokenMatches) {
      res.status(403).json({ ok: false, reason: "this-computer", error: setupToken ? "Enter the setup token, or create the recovery administrator on the computer running Studio." : "Create the recovery administrator on the computer running Studio." });
      return;
    }
    if (bootstrapping) {
      res.status(409).json({ ok: false, error: "Recovery administrator setup is already in progress." });
      return;
    }
    try {
      bootstrapping = createLocalAccount({ username: req.body?.username, displayName: req.body?.displayName, password: req.body?.password, role: "administrator", onlyIfEmpty: true });
      const account = await bootstrapping;
      const session = createAccountSession(account.id);
      appendCookie(res, accountCookie(req, session.token, session.maxAge));
      res.status(201).json(publicStatus({ ...req, heissAccount: { authenticated: true, userId: account.id, role: account.role, generationProfiles: [], features: {} } }));
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    } finally {
      bootstrapping = null;
    }
  });

  post("/api/accounts/sign-in", async (req, res) => {
    if (!multiUserEnabled) return res.status(404).json({ ok: false, error: "Account sign-in is disabled." });
    const client = clientOf(req);
    // One lane per address and username: behind a proxy every client shares an address.
    const lane = `${client.address}|${String(req.body?.username || "").trim().normalize("NFKC").toLocaleLowerCase("en-AU").slice(0, 64)}`;
    const result = await limiter.attempt(lane, false, () => verifyLocalAccount(req.body?.username, req.body?.password));
    if (result.reason === "busy") {
      res.status(429).setHeader("Retry-After", "1").json({ ok: false, error: "Wait a moment, then try again." });
      return;
    }
    if (result.reason === "locked") {
      res.status(429).setHeader("Retry-After", String(Math.ceil(result.retryAfterMs / 1000))).json({ ok: false, error: `Too many sign-in attempts. Try again in ${waitWords(result.retryAfterMs)}.` });
      return;
    }
    if (!result.ok || !result.value) {
      if (result.retryAfterMs) res.setHeader("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)));
      res.status(401).json({ ok: false, error: "That email or password is incorrect, or the account is not approved." });
      return;
    }
    const session = createAccountSession(result.value.userId);
    appendCookie(res, accountCookie(req, session.token, session.maxAge));
    req.heissAccount = result.value;
    res.json(publicStatus(req));
  });

  // The provider's redirect back is a cross-site navigation, so this short-lived state cookie is Lax.
  const stateCookie = (req, value, maxAge) => [`${oidcStateCookie}=${value}`, "Path=/api/accounts/oidc", `Max-Age=${maxAge}`, "HttpOnly", "SameSite=Lax", ...(secureRequest(req) ? ["Secure"] : [])].join("; ");

  get("/api/accounts/oidc/start", async (req, res) => {
    if (!oidc) return res.status(404).json({ ok: false, error: "Single sign-on is not configured." });
    try {
      const { url, state } = await oidc.start();
      appendCookie(res, stateCookie(req, state, 600));
      res.setHeader("Cache-Control", "no-store");
      res.redirect(302, url);
    } catch (error) {
      console.warn(`[Studio] Single sign-on could not start: ${error.message}`);
      res.redirect(302, "/?sign-in=unavailable");
    }
  });

  get("/api/accounts/oidc/callback", async (req, res) => {
    if (!oidc) return res.status(404).json({ ok: false, error: "Single sign-on is not configured." });
    appendCookie(res, stateCookie(req, "", 0));
    res.setHeader("Cache-Control", "no-store");
    try {
      if (req.query?.error) throw new Error(`The provider declined: ${String(req.query.error).slice(0, 80)}`);
      const identity = await oidc.finish({ code: String(req.query?.code || ""), state: String(req.query?.state || ""), expectedState: cookieToken(req, oidcStateCookie) });
      const result = signInWithOidcIdentity(identity);
      if (result.refused) return res.redirect(302, "/?sign-in=refused");
      if (result.pending) return res.redirect(302, "/?sign-in=pending");
      const session = createAccountSession(result.access.userId);
      appendCookie(res, accountCookie(req, session.token, session.maxAge));
      res.redirect(302, "/");
    } catch (error) {
      console.warn(`[Studio] Single sign-on failed: ${error.message}`);
      res.redirect(302, "/?sign-in=failed");
    }
  });

  // Every session this browser holds ends: the account's, and a studio-password device session left from single-user mode.
  post("/api/accounts/sign-out", (req, res) => {
    revokeAccountSession(cookieToken(req));
    appendCookie(res, accountCookie(req, ""));
    endDeviceSession(req, res);
    req.heissAccount = null;
    res.json({ ok: true });
  });

  get("/api/accounts/mcp-token", (req, res) => {
    const account = accountForRequest(req);
    if (!account) return res.status(401).json({ ok: false, error: "Sign in to manage your MCP token." });
    res.setHeader("Cache-Control", "no-store");
    const endpointBase = process.env.MCP_PUBLIC_URL?.replace(/\/+$/, "") || `${req.protocol}://${req.get("host")}`;
    res.json({ ok: true, endpoint: `${endpointBase}/mcp`, ...accountMcpTokenStatus(account.userId) });
  });

  post("/api/accounts/mcp-token", (req, res) => {
    const account = accountForRequest(req);
    if (!account) return res.status(401).json({ ok: false, error: "Sign in to manage your MCP token." });
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true, ...rotateAccountMcpToken(account.userId) });
    } catch (error) { res.status(400).json({ ok: false, error: error.message }); }
  });

  post("/api/accounts/mcp-token/revoke", (req, res) => {
    const account = accountForRequest(req);
    if (!account) return res.status(401).json({ ok: false, error: "Sign in to manage your MCP token." });
    try {
      revokeAccountMcpToken(account.userId);
      res.json({ ok: true, ...accountMcpTokenStatus(account.userId) });
    } catch (error) { res.status(400).json({ ok: false, error: error.message }); }
  });

  // Settings › Account: the signed-in account, what it may change, and its MCP token in one request.
  get("/api/accounts/me", (req, res) => {
    const access = accountForRequest(req);
    const account = access && ownAccount(access.userId);
    if (!account) return res.status(401).json({ ok: false, error: "Sign in to see your account." });
    res.setHeader("Cache-Control", "no-store");
    const endpointBase = process.env.MCP_PUBLIC_URL?.replace(/\/+$/, "") || `${req.protocol}://${req.get("host")}`;
    res.json({ ok: true, account, mcp: { endpoint: `${endpointBase}/mcp`, ...accountMcpTokenStatus(account.id) } });
  });

  patch("/api/accounts/me", async (req, res) => {
    const access = accountForRequest(req);
    if (!access || access.credential === "mcp-token") return res.status(401).json({ ok: false, error: "Sign in to change your account." });
    const body = req.body || {};
    const changes = { displayName: body.displayName, username: body.username, currentPassword: body.currentPassword, newPassword: body.newPassword };
    try {
      if (typeof body.username !== "string" && !body.newPassword) return res.json({ ok: true, account: await updateOwnAccount(access.userId, { displayName: body.displayName }) });
      validateOwnAccountChange(access.userId, changes);
      // Checking the current password is a guess like a sign-in, so it shares the limiter.
      const lane = `${clientOf(req).address}|me:${access.userId}`;
      const result = await limiter.attempt(lane, false, async () => {
        try { return await updateOwnAccount(access.userId, changes, { keepSessionToken: cookieToken(req) }); }
        catch (error) { if (error.message === wrongCurrentPassword) return null; throw error; }
      });
      if (result.reason === "busy" || result.reason === "locked") {
        res.status(429).setHeader("Retry-After", String(Math.max(1, Math.ceil((result.retryAfterMs || 1000) / 1000)))).json({ ok: false, error: result.reason === "locked" ? `Too many attempts. Try again in ${waitWords(result.retryAfterMs)}.` : "Wait a moment, then try again." });
        return;
      }
      if (!result.ok || !result.value) return res.status(400).json({ ok: false, error: wrongCurrentPassword });
      res.json({ ok: true, account: result.value });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  get("/api/accounts/admin", async (req, res) => {
    if (!requireAccountAdmin(req, res)) return;
    const [profiles, cloud] = await Promise.all([availableProfiles(), cloudProfiles()]);
    migrateCloudModelAccess(cloud);
    ensureBuiltInAccessProfiles();
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      accounts: listAccounts(),
      accessProfiles: listAccessProfiles(),
      availableProfiles: profiles,
      defaultAccessProfileId: defaultAccessProfileId(),
      requireApproval: requireApproval(),
      // Features the deployment switched off for everyone; their access-profile options show locked.
      lockedFeatures: { loras: !lorasEnabled, cloudModels: !grokEnabled, presets: !presetsEnabled() },
      gateway: listGatewayIdentities()
    });
  });

  post("/api/accounts/default-profile", (req, res) => {
    if (!requireAccountAdmin(req, res)) return;
    try {
      const body = req.body || {};
      if (typeof body.requireApproval === "boolean") setRequireApproval(body.requireApproval);
      if (typeof body.accessProfileId === "string") setDefaultAccessProfile(body.accessProfileId);
      res.json({ ok: true, defaultAccessProfileId: defaultAccessProfileId(), requireApproval: requireApproval() });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  post("/api/accounts/gateway-links", (req, res) => {
    if (!requireAccountAdmin(req, res)) return;
    try {
      res.json({ ok: true, gateway: setGatewayLink(req.body?.identity, typeof req.body?.accountId === "string" ? req.body.accountId : "") });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  post("/api/accounts/gateway-pending/dismiss", (req, res) => {
    if (!requireAccountAdmin(req, res)) return;
    try {
      res.json({ ok: true, gateway: dismissGatewayIdentity(req.body?.identity) });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  post("/api/accounts/profiles", async (req, res) => {
    if (!requireAccountAdmin(req, res)) return;
    try {
      const [profiles, cloud] = await Promise.all([availableProfiles(), cloudProfiles()]);
      res.json({ ok: true, profile: saveAccessProfile(req.body, profiles, cloud) });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  post("/api/accounts/users", async (req, res) => {
    if (!requireAccountAdmin(req, res)) return;
    try {
      const account = await createLocalAccount({ ...req.body, role: "user" });
      res.status(201).json({ ok: true, account });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  patch("/api/accounts/users/:id", async (req, res) => {
    if (!requireAccountAdmin(req, res)) return;
    try {
      // Each change is explicit: a missing or misspelt field must never re-enable an account.
      const body = req.body || {};
      let account;
      if (typeof body.accessProfileId === "string") account = assignAccessProfile(req.params.id, body.accessProfileId);
      else if (typeof body.disabled === "boolean") account = setAccountDisabled(req.params.id, body.disabled);
      else return res.status(400).json({ ok: false, error: "Choose an access profile or account status." });
      res.json({ ok: true, account });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });
}
