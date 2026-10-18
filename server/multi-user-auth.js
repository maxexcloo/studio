import { accountMcpTokenStatus, accountSession, accountStoreSnapshot, assignAccessProfile, createAccountSession, createLocalAccount, listAccessProfiles, listAccounts, revokeAccountMcpToken, revokeAccountSession, rotateAccountMcpToken, saveAccessProfile, setAccountDisabled, verifyAccountMcpToken, verifyLocalAccount } from "./account-store.js";
import { canAdmin, clientOf } from "./access.js";
import { createGuessLimiter, waitWords } from "./guess-limit.js";

export const multiUserEnabled = process.env.HEISS_MULTI_USER === "1";
export const accountCookieName = process.env.HEISS_ACCOUNT_COOKIE_NAME || "heiss_account";
const limiter = createGuessLimiter();

function cookieToken(req) {
  for (const part of String(req?.headers?.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== accountCookieName) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return ""; }
  }
  return "";
}

export function accountForRequest(req) {
  if (req?.heissAccount !== undefined) return req.heissAccount;
  const bearer = /^Bearer ([^\s]+)$/i.exec(String(req?.headers?.authorization || ""))?.[1] || "";
  const account = accountSession(cookieToken(req)) || verifyAccountMcpToken(bearer);
  if (req) req.heissAccount = account;
  return account;
}

function appendCookie(res, cookie) {
  const current = res.getHeader?.("Set-Cookie") ?? res.headers?.["Set-Cookie"];
  res.setHeader("Set-Cookie", [].concat(current || [], cookie));
}

function accountCookie(req, value, maxAge = 0) {
  return [`${accountCookieName}=${value}`, "Path=/", `Max-Age=${maxAge}`, "HttpOnly", "SameSite=Strict", ...(req?.socket?.encrypted ? ["Secure"] : [])].join("; ");
}

function publicStatus(req) {
  if (!multiUserEnabled) return { ok: true, mode: "single-user" };
  const account = accountForRequest(req);
  return {
    ok: true,
    mode: "multi-user",
    signedIn: Boolean(account),
    account: account ? { id: account.userId, role: account.role, generationProfiles: account.generationProfiles, features: account.features } : null,
    needsRecoveryAdmin: accountStoreSnapshot().accounts.length === 0
  };
}

function requireAccountAdmin(req, res) {
  if (multiUserEnabled && canAdmin(req)) return true;
  res.status(multiUserEnabled ? 403 : 404).json({ ok: false, error: multiUserEnabled ? "Administrator access is required." : "Account management is disabled." });
  return false;
}

export function registerMultiUserAuthRoutes(app, { availableProfiles = async () => [] } = {}) {
  app.get("/api/accounts/status", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(publicStatus(req));
  });

  app.post("/api/accounts/bootstrap", async (req, res) => {
    if (!multiUserEnabled || accountStoreSnapshot().accounts.length) {
      res.status(409).json({ ok: false, error: "Recovery administrator setup is already complete." });
      return;
    }
    if (!clientOf(req).thisComputer) {
      res.status(403).json({ ok: false, reason: "this-computer", error: "Create the recovery administrator on the computer running HEISS UI." });
      return;
    }
    try {
      const account = await createLocalAccount({ username: req.body?.username, displayName: req.body?.displayName, password: req.body?.password, role: "administrator" });
      const session = createAccountSession(account.id);
      appendCookie(res, accountCookie(req, session.token, session.maxAge));
      res.status(201).json(publicStatus({ ...req, heissAccount: { authenticated: true, userId: account.id, role: account.role, generationProfiles: [], features: {} } }));
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/accounts/sign-in", async (req, res) => {
    if (!multiUserEnabled) return res.status(404).json({ ok: false, error: "Account sign-in is disabled." });
    const client = clientOf(req);
    const result = await limiter.attempt(client.address, false, () => verifyLocalAccount(req.body?.username, req.body?.password));
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
      res.status(401).json({ ok: false, error: "That username or password is incorrect, or the account is not approved." });
      return;
    }
    const session = createAccountSession(result.value.userId);
    appendCookie(res, accountCookie(req, session.token, session.maxAge));
    req.heissAccount = result.value;
    res.json(publicStatus(req));
  });

  app.post("/api/accounts/sign-out", (req, res) => {
    revokeAccountSession(cookieToken(req));
    appendCookie(res, accountCookie(req, ""));
    req.heissAccount = null;
    res.json({ ok: true });
  });

  app.get("/api/accounts/mcp-token", (req, res) => {
    const account = accountForRequest(req);
    if (!account) return res.status(401).json({ ok: false, error: "Sign in to manage your MCP token." });
    res.setHeader("Cache-Control", "no-store");
    const endpointBase = process.env.MCP_PUBLIC_URL?.replace(/\/+$/, "") || `${req.protocol}://${req.get("host")}`;
    res.json({ ok: true, endpoint: `${endpointBase}/mcp`, ...accountMcpTokenStatus(account.userId) });
  });

  app.post("/api/accounts/mcp-token", (req, res) => {
    const account = accountForRequest(req);
    if (!account) return res.status(401).json({ ok: false, error: "Sign in to manage your MCP token." });
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true, ...rotateAccountMcpToken(account.userId) });
    } catch (error) { res.status(400).json({ ok: false, error: error.message }); }
  });

  app.post("/api/accounts/mcp-token/revoke", (req, res) => {
    const account = accountForRequest(req);
    if (!account) return res.status(401).json({ ok: false, error: "Sign in to manage your MCP token." });
    try {
      revokeAccountMcpToken(account.userId);
      res.json({ ok: true, ...accountMcpTokenStatus(account.userId) });
    } catch (error) { res.status(400).json({ ok: false, error: error.message }); }
  });

  app.get("/api/accounts/admin", async (req, res) => {
    if (!requireAccountAdmin(req, res)) return;
    const profiles = await availableProfiles();
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, accounts: listAccounts(), accessProfiles: listAccessProfiles(profiles), availableProfiles: profiles });
  });

  app.post("/api/accounts/profiles", async (req, res) => {
    if (!requireAccountAdmin(req, res)) return;
    try {
      res.json({ ok: true, profile: saveAccessProfile(req.body, await availableProfiles()) });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/accounts/users", async (req, res) => {
    if (!requireAccountAdmin(req, res)) return;
    try {
      const account = await createLocalAccount({ ...req.body, role: "user" });
      res.status(201).json({ ok: true, account });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.patch("/api/accounts/users/:id", (req, res) => {
    if (!requireAccountAdmin(req, res)) return;
    try {
      const account = req.body?.accessProfileId
        ? assignAccessProfile(req.params.id, req.body.accessProfileId)
        : setAccountDisabled(req.params.id, req.body?.disabled === true);
      res.json({ ok: true, account });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });
}
