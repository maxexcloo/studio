import {
  accountAccessForId,
  ownAccount,
  updateOwnAccount,
  validateOwnAccountChange,
  wrongCurrentPassword,
  dismissGatewayIdentity,
  listGatewayIdentities,
  setGatewayLink,
  signInWithOidcIdentity,
  accountMcpTokenStatus,
  accountSession,
  accountStoreSnapshot,
  assignAccessProfile,
  createAccountSession,
  createLocalAccount,
  defaultAccessProfileId,
  gatewayAdminTools,
  setGatewayAdminTools,
  ensureBuiltInAccessProfile,
  listAccessProfiles,
  setDefaultAccessProfile,
  listAccounts,
  revokeAccountMcpToken,
  revokeAccountSession,
  rotateAccountMcpToken,
  saveAccessProfile,
  deleteAccessProfile,
  deleteAccount,
  resetAccountPassword,
  setAccountDisabled,
  setAccountRole,
  verifyAccountMcpToken,
  verifyLocalAccount,
} from "./account-store.js";
import { accountCookieName, canAdmin, clientOf, cookieToken } from "./access.js";
import { directRoute } from "./domain/direct-route.ts";
import { createGuessLimiter, waitWords } from "./guess-limit.js";
import { createOidcClient, oidcConfigFromEnv } from "./oidc.js";

export const multiUserEnabled = process.env.STUDIO_MULTI_USER === "1";
const oidcStateCookie = `${accountCookieName}_oidc`;
const limiter = createGuessLimiter();

/**
 * Whose guesses these are. Behind Traefik every request comes from the proxy's address, so a proxied
 * request counts against the client Cloudflare names, else the one the nearest proxy appended to
 * X-Forwarded-For. A client can choose its own bucket with these headers, so they serve only
 * rate limiting, never a trust decision (that stays with clientOf).
 */
function guessLane(req) {
  const client = clientOf(req);
  if (!client.proxied) return client.address;
  const forwarded = String(req.headers?.["x-forwarded-for"] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const named = String(req.headers?.["cf-connecting-ip"] || "").trim() || forwarded.at(-1);
  return named ? `client:${named.slice(0, 64)}` : client.address;
}

// Personal MCP tokens reach only the routes MCP itself calls, never account or studio administration.
const mcpBearerRoutes = [
  // The account's own role and features (mcp/media.js access), as the status route reports them.
  ["GET", /^\/api\/accounts\/status$/],
  ["GET", /^\/api\/models$/],
  ["GET", /^\/api\/loras\/info$/],
  // The account's LoRA thumbs up and down, which order every LoRA list MCP shows.
  ["GET", /^\/api\/loras\/library$/],
  ["POST", /^\/api\/generate$/],
  ["GET", /^\/api\/jobs\/[\w-]+$/],
  ["POST", /^\/api\/jobs\/[\w-]+\/cancel$/],
  ["GET", /^\/api\/gallery\/jobs\/[\w-]+$/],
  // The search tool: the account's own gallery search.
  ["GET", /^\/api\/gallery$/],
  ["POST", /^\/api\/reference-assets\/upload$/],
  // The reuse tool's extend: a video result's last frame as the next video's first.
  ["POST", /^\/api\/reference-assets\/from-gallery$/],
  // A multi-model run's side-by-side page, of the account's own image jobs.
  ["POST", /^\/api\/comparisons$/],
  // An uploaded reference's own pixels (owner-scoped): rewrite_prompt's vision references and import's upload_id.
  ["GET", /^\/api\/reference-assets\/[^/]+\/media$/],
  ["GET", /^\/comfy\/view$/],
  // The account's own gallery, queue, Dream and taste (mcp/manage.js) and reuse's upscale, as the
  // UI calls them; each route scopes to the account and checks its group's features.
  ["POST", /^\/api\/gallery\/(?:delete|favorite|errors\/clear)$/],
  ["GET", /^\/api\/queue$/],
  ["POST", /^\/api\/queue\/(?:pause|resume|cancel-all|clear-failed|[\w-]+\/(?:clear|move|retry))$/],
  ["GET", /^\/api\/dream(?:\/discarded)?$/],
  ["PUT", /^\/api\/dream\/settings$/],
  ["POST", /^\/api\/dream\/(?:[^/]+\/(?:keep|discard|more|variations)|pairs\/[^/]+\/answer)$/],
  ["GET", /^\/api\/taste$/],
  ["PUT", /^\/api\/taste$/],
  ["DELETE", /^\/api\/taste$/],
  ["POST", /^\/api\/taste\/refresh$/],
  ["POST", /^\/api\/loras\/library\/ops$/],
  ["POST", /^\/api\/upscale$/],
];

function mcpBearerRouteAllowed(method, routePath) {
  return mcpBearerRoutes.some(
    ([allowedMethod, pattern]) => allowedMethod === method && pattern.test(routePath),
  );
}

/**
 * The routes MCP's admin tools call (mcp-admin.js): the Library, downloads, the catalogue, profiles,
 * guides, Combine Backends, the export, and accounts' groups. Only an administrator's own MCP token reaches them, or
 * Studio's own credential for a gateway-linked administrator while Chat Gateway Admin Tools is on.
 * Nothing here deletes a model file, replaces a download or touches a GPU; Combine Backends backs up
 * the profiles it replaces.
 */
const routeId = "[\\w.-]+";
const mcpAdminRoutes = [
  ["GET", /^\/api\/library\/items$/],
  ["GET", /^\/api\/library\/imports$/],
  ["POST", /^\/api\/library\/imports$/],
  ["POST", /^\/api\/library\/imports\/image$/],
  ["POST", /^\/api\/library\/imports\/clear-failed$/],
  ["GET", new RegExp(`^/api/library/imports/${routeId}$`)],
  ["POST", new RegExp(`^/api/library/imports/${routeId}/(?:download|describe|draft-profile)$`)],
  ["POST", /^\/api\/library\/lookup$/],
  ["GET", /^\/api\/library\/placement$/],
  ["PATCH", /^\/api\/library\/catalogue$/],
  ["POST", /^\/api\/library\/catalogue\/(?:remove|undo)$/],
  ["GET", /^\/api\/library\/updates$/],
  ["POST", /^\/api\/library\/updates\/(?:check|apply)$/],
  ["GET", /^\/api\/models\/downloads$/],
  ["POST", /^\/api\/models\/downloads$/],
  ["POST", /^\/api\/models\/downloads\/cancel$/],
  ["GET", /^\/api\/profiles\/editable$/],
  ["GET", new RegExp(`^/api/profiles/editable/${routeId}(?:/guide|/versions|/versions/\\d+)?$`)],
  ["PUT", new RegExp(`^/api/profiles/editable/${routeId}$`)],
  ["POST", new RegExp(`^/api/profiles/editable/${routeId}/(?:approve|remove|revert)$`)],
  ["GET", /^\/api\/profiles\/guides$/],
  ["GET", new RegExp(`^/api/profiles/guides/${routeId}(?:/versions|/versions/\\d+)?$`)],
  ["PUT", new RegExp(`^/api/profiles/guides/${routeId}$`)],
  ["POST", new RegExp(`^/api/profiles/guides/${routeId}/(?:approve|revert)$`)],
  ["GET", /^\/api\/profiles\/guide-bindings(?:\/versions|\/versions\/\d+)?$/],
  ["PUT", /^\/api\/profiles\/guide-bindings$/],
  ["POST", /^\/api\/profiles\/guide-bindings\/(?:approve|revert)$/],
  ["GET", /^\/api\/profiles\/backends$/],
  ["POST", /^\/api\/profiles\/backends\/combine$/],
  ["GET", /^\/api\/profiles\/export$/],
  ["GET", /^\/api\/accounts\/admin$/],
  ["POST", /^\/api\/accounts\/profiles$/],
  ["POST", /^\/api\/accounts\/default-profile$/],
  ["DELETE", new RegExp(`^/api/accounts/profiles/${routeId}$`)],
  ["PATCH", new RegExp(`^/api/accounts/users/${routeId}$`)],
  ["DELETE", new RegExp(`^/api/accounts/users/${routeId}$`)],
  // Removing one import record (its files stay) and Library › Import's Reddit posts.
  ["DELETE", new RegExp(`^/api/library/imports/${routeId}$`)],
  ["POST", /^\/api\/gallery\/import\/reddit$/],
  // The Maintenance tool: migrations (each writes a backup), unfinished jobs, the global pause and
  // Merge Duplicate Profiles (after a backup).
  ["POST", /^\/api\/maintenance\/migrations$/],
  ["GET", /^\/api\/maintenance\/unfinished$/],
  ["POST", /^\/api\/maintenance\/unfinished\/(?:retry|delete)$/],
  ["POST", /^\/api\/queue\/(?:pause|resume)-all$/],
  ["GET", /^\/api\/profiles\/duplicates$/],
  ["POST", /^\/api\/profiles\/duplicates\/merge$/],
];

export function mcpAdminRouteAllowed(method, routePath) {
  return mcpAdminRoutes.some(
    ([allowedMethod, pattern]) => allowedMethod === method && pattern.test(routePath),
  );
}

/** An administrator's access on an admin route, marked as MCP's so the routes record chat as its origin. */
const asMcpAdmin = (access) =>
  access?.authenticated && access.role === "administrator"
    ? { ...access, credential: "mcp-admin" }
    : null;

/**
 * The account an MCP call acts as on a route, called in process (mcp/studio-requests.js): by the
 * account's personal token (`{ token }`), as a bearer request is; or by Studio's own word for
 * `owner` (`{ internal: true }`: a gateway-linked account, Studio Chat, a result or upload link).
 */
export function mcpAccount(owner, credential, method, routePath) {
  if (credential?.token) {
    if (mcpBearerRouteAllowed(method, routePath)) return verifyAccountMcpToken(credential.token);
    if (mcpAdminRouteAllowed(method, routePath))
      return asMcpAdmin(verifyAccountMcpToken(credential.token));
    return null;
  }
  if (!credential?.internal) return null;
  const access = accountAccessForId(owner);
  // A gateway-linked administrator reaches the admin routes only while Chat Gateway Admin Tools is on.
  if (mcpAdminRouteAllowed(method, routePath))
    return gatewayAdminTools() ? asMcpAdmin(access) : null;
  if (!mcpBearerRouteAllowed(method, routePath)) return null;
  return access?.authenticated ? { ...access, credential: "mcp-token" } : null;
}

export function accountForRequest(req) {
  if (req?.studioAccount !== undefined) return req.studioAccount;
  const bearer = /^Bearer ([^\s]+)$/i.exec(String(req?.headers?.authorization || ""))?.[1] || "";
  const routePath = String(req?.path || req?.url || "").split("?")[0];
  const method = String(req?.method || "GET").toUpperCase();
  const account =
    accountSession(cookieToken(req)) ||
    (bearer && mcpBearerRouteAllowed(method, routePath) ? verifyAccountMcpToken(bearer) : null) ||
    (bearer && mcpAdminRouteAllowed(method, routePath)
      ? asMcpAdmin(verifyAccountMcpToken(bearer))
      : null);
  if (req) req.studioAccount = account;
  return account;
}

function appendCookie(res, cookie) {
  const current = res.getHeader?.("Set-Cookie") ?? res.headers?.["Set-Cookie"];
  res.setHeader("Set-Cookie", [].concat(current || [], cookie));
}

// Behind a TLS-terminating proxy the socket is plain HTTP; a forged header only affects its sender.
function secureRequest(req) {
  return (
    Boolean(req?.socket?.encrypted) ||
    String(req?.headers?.["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim()
      .toLowerCase() === "https"
  );
}

function accountCookie(req, value, maxAge = 0) {
  return [
    `${accountCookieName}=${value}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Strict",
    ...(secureRequest(req) ? ["Secure"] : []),
  ].join("; ");
}

function publicStatus(req) {
  if (!multiUserEnabled) return { ok: true, mode: "single-user" };
  const account = accountForRequest(req);
  return {
    ok: true,
    mode: "multi-user",
    signedIn: Boolean(account),
    account: account
      ? {
          id: account.userId,
          role: account.role,
          generationProfiles: account.generationProfiles,
          features: account.features,
        }
      : null,
    needsRecoveryAdmin: accountStoreSnapshot().accounts.length === 0,
    ...(oidc ? { oidc: { label: oidc.label } } : {}),
  };
}

function requireAccountAdmin(req, res) {
  if (multiUserEnabled && canAdmin(req)) return true;
  const { status, payload } = accountAdminRefusal();
  res.status(status).json(payload);
  return false;
}
/** requireAccountAdmin for a shared route's account (domain/direct-route.ts): the refusal, or null. */
function accountAdminRefusal(account) {
  if (multiUserEnabled && account?.role === "administrator" && account.credential !== "mcp-token")
    return null;
  return {
    status: multiUserEnabled ? 403 : 404,
    payload: {
      ok: false,
      error: multiUserEnabled
        ? "Administrator access is required."
        : "Account management is disabled.",
    },
  };
}

let oidc = null;

/**
 * `availableProfiles` lists the grantable local profile ids; `cloudProfiles` the cloud ones,
 * which access profiles grant through their Cloud Models feature instead.
 */
export function registerMultiUserAuthRoutes(
  app,
  { availableProfiles = async () => [], cloudProfiles = async () => [], oidcClient } = {},
) {
  oidc =
    oidcClient !== undefined
      ? oidcClient
      : multiUserEnabled && oidcConfigFromEnv()
        ? createOidcClient(oidcConfigFromEnv())
        : null;
  // Single-user mode answers only the status route, even if an old account store remains.
  const route = (method) => (path, handler) =>
    app[method](path, (req, res) =>
      multiUserEnabled || path === "/api/accounts/status"
        ? handler(req, res)
        : res.status(404).json({ ok: false, error: "Accounts are disabled." }),
    );
  const [get, post, patch] = ["get", "post", "patch"].map(route);
  /** An administrator's account route that MCP's admin tools also call. */
  const admin = (method, path, run) =>
    directRoute(app, method, path, (account, input) => {
      if (!multiUserEnabled)
        return { status: 404, payload: { ok: false, error: "Accounts are disabled." } };
      return accountAdminRefusal(account) || run(account, input);
    });
  let bootstrapping = null;

  // Whoever asks, so the status finds the caller's account itself (MCP passes the one it found).
  app.get("/api/accounts/status", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (multiUserEnabled) accountForRequest(req);
    next();
  });
  directRoute(app, "GET", "/api/accounts/status", (account) => ({
    status: 200,
    payload: publicStatus({ studioAccount: account ?? null }),
  }));

  post("/api/accounts/bootstrap", async (req, res) => {
    if (!multiUserEnabled || accountStoreSnapshot().accounts.length) {
      res
        .status(409)
        .json({ ok: false, error: "Recovery administrator setup is already complete." });
      return;
    }
    if (!clientOf(req).thisComputer) {
      res.status(403).json({
        ok: false,
        reason: "this-computer",
        error: "Create the recovery administrator on the computer running Studio.",
      });
      return;
    }
    if (bootstrapping) {
      res
        .status(409)
        .json({ ok: false, error: "Recovery administrator setup is already in progress." });
      return;
    }
    try {
      bootstrapping = createLocalAccount({
        username: req.body?.username,
        password: req.body?.password,
        role: "administrator",
        onlyIfEmpty: true,
      });
      const account = await bootstrapping;
      const session = createAccountSession(account.id);
      appendCookie(res, accountCookie(req, session.token, session.maxAge));
      res.status(201).json(
        publicStatus({
          ...req,
          studioAccount: {
            authenticated: true,
            userId: account.id,
            role: account.role,
            generationProfiles: [],
            features: {},
          },
        }),
      );
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    } finally {
      bootstrapping = null;
    }
  });

  post("/api/accounts/sign-in", async (req, res) => {
    if (!multiUserEnabled)
      return res.status(404).json({ ok: false, error: "Account sign-in is disabled." });
    const result = await limiter.attempt(guessLane(req), false, () =>
      verifyLocalAccount(req.body?.username, req.body?.password),
    );
    if (result.reason === "busy") {
      res
        .status(429)
        .setHeader("Retry-After", "1")
        .json({ ok: false, error: "Wait a moment, then try again." });
      return;
    }
    if (result.reason === "locked") {
      res
        .status(429)
        .setHeader("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)))
        .json({
          ok: false,
          error: `Too many sign-in attempts. Try again in ${waitWords(result.retryAfterMs)}.`,
        });
      return;
    }
    if (!result.ok || !result.value) {
      if (result.retryAfterMs)
        res.setHeader("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)));
      res.status(401).json({
        ok: false,
        error: "That email or password is incorrect, or the account is not approved.",
      });
      return;
    }
    const session = createAccountSession(result.value.userId);
    appendCookie(res, accountCookie(req, session.token, session.maxAge));
    req.studioAccount = result.value;
    res.json(publicStatus(req));
  });

  // The provider's redirect back is a cross-site navigation, so this short-lived state cookie is Lax.
  const stateCookie = (req, value, maxAge) =>
    [
      `${oidcStateCookie}=${value}`,
      "Path=/api/accounts/oidc",
      `Max-Age=${maxAge}`,
      "HttpOnly",
      "SameSite=Lax",
      ...(secureRequest(req) ? ["Secure"] : []),
    ].join("; ");

  get("/api/accounts/oidc/start", async (req, res) => {
    if (!oidc)
      return res.status(404).json({ ok: false, error: "Single sign-on is not configured." });
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
    if (!oidc)
      return res.status(404).json({ ok: false, error: "Single sign-on is not configured." });
    appendCookie(res, stateCookie(req, "", 0));
    res.setHeader("Cache-Control", "no-store");
    try {
      if (req.query?.error)
        throw new Error(`The provider declined: ${String(req.query.error).slice(0, 80)}`);
      const identity = await oidc.finish({
        code: String(req.query?.code || ""),
        state: String(req.query?.state || ""),
        expectedState: cookieToken(req, oidcStateCookie),
      });
      const result = signInWithOidcIdentity(identity);
      if (result.refused) return res.redirect(302, "/?sign-in=refused");
      const session = createAccountSession(result.access.userId);
      appendCookie(res, accountCookie(req, session.token, session.maxAge));
      res.redirect(302, "/");
    } catch (error) {
      console.warn(`[Studio] Single sign-on failed: ${error.message}`);
      res.redirect(302, "/?sign-in=failed");
    }
  });

  // The account's session ends.
  post("/api/accounts/sign-out", (req, res) => {
    revokeAccountSession(cookieToken(req));
    appendCookie(res, accountCookie(req, ""));
    req.studioAccount = null;
    res.json({ ok: true });
  });

  get("/api/accounts/mcp-token", (req, res) => {
    const account = accountForRequest(req);
    if (!account)
      return res.status(401).json({ ok: false, error: "Sign in to manage your MCP token." });
    res.setHeader("Cache-Control", "no-store");
    const endpointBase =
      process.env.STUDIO_MCP_PUBLIC_URL?.replace(/\/+$/, "") ||
      `${req.protocol}://${req.get("host")}`;
    res.json({
      ok: true,
      endpoint: `${endpointBase}/mcp`,
      ...accountMcpTokenStatus(account.userId),
    });
  });

  post("/api/accounts/mcp-token", (req, res) => {
    const account = accountForRequest(req);
    if (!account)
      return res.status(401).json({ ok: false, error: "Sign in to manage your MCP token." });
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true, ...rotateAccountMcpToken(account.userId) });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  post("/api/accounts/mcp-token/revoke", (req, res) => {
    const account = accountForRequest(req);
    if (!account)
      return res.status(401).json({ ok: false, error: "Sign in to manage your MCP token." });
    try {
      revokeAccountMcpToken(account.userId);
      res.json({ ok: true, ...accountMcpTokenStatus(account.userId) });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  // Settings › Account: the signed-in account, what it may change, and its MCP token in one request.
  get("/api/accounts/me", (req, res) => {
    const access = accountForRequest(req);
    const account = access && ownAccount(access.userId);
    if (!account) return res.status(401).json({ ok: false, error: "Sign in to see your account." });
    res.setHeader("Cache-Control", "no-store");
    const endpointBase =
      process.env.STUDIO_MCP_PUBLIC_URL?.replace(/\/+$/, "") ||
      `${req.protocol}://${req.get("host")}`;
    res.json({
      ok: true,
      account,
      mcp: { endpoint: `${endpointBase}/mcp`, ...accountMcpTokenStatus(account.id) },
    });
  });

  patch("/api/accounts/me", async (req, res) => {
    const access = accountForRequest(req);
    if (!access || access.credential === "mcp-token")
      return res.status(401).json({ ok: false, error: "Sign in to change your account." });
    const body = req.body || {};
    const changes = {
      username: body.username,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    };
    try {
      validateOwnAccountChange(access.userId, changes);
      // Checking the current password is a guess like a sign-in, so it shares the client's lane.
      const result = await limiter.attempt(guessLane(req), false, async () => {
        try {
          return await updateOwnAccount(access.userId, changes, {
            keepSessionToken: cookieToken(req),
          });
        } catch (error) {
          if (error.message === wrongCurrentPassword) return null;
          throw error;
        }
      });
      if (result.reason === "busy" || result.reason === "locked") {
        res
          .status(429)
          .setHeader(
            "Retry-After",
            String(Math.max(1, Math.ceil((result.retryAfterMs || 1000) / 1000))),
          )
          .json({
            ok: false,
            error:
              result.reason === "locked"
                ? `Too many attempts. Try again in ${waitWords(result.retryAfterMs)}.`
                : "Wait a moment, then try again.",
          });
        return;
      }
      if (!result.ok || !result.value)
        return res.status(400).json({ ok: false, error: wrongCurrentPassword });
      res.json({ ok: true, account: result.value });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/accounts/admin", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  admin("GET", "/api/accounts/admin", async () => {
    const profiles = await availableProfiles();
    ensureBuiltInAccessProfile();
    return {
      status: 200,
      payload: {
        ok: true,
        accounts: listAccounts(),
        accessProfiles: listAccessProfiles(),
        availableProfiles: profiles,
        defaultAccessProfileId: defaultAccessProfileId(),
        gateway: { ...listGatewayIdentities(), adminTools: gatewayAdminTools() },
      },
    };
  });

  admin("POST", "/api/accounts/default-profile", (_account, { body }) => {
    try {
      return {
        status: 200,
        payload: {
          ok: true,
          defaultAccessProfileId: setDefaultAccessProfile(body?.accessProfileId),
        },
      };
    } catch (error) {
      return { status: 400, payload: { ok: false, error: error.message } };
    }
  });

  // Chat Gateway Admin Tools: gateway-linked administrators get MCP's admin tools (off by default).
  post("/api/accounts/gateway-admin", (req, res) => {
    if (!requireAccountAdmin(req, res)) return;
    try {
      res.json({ ok: true, adminTools: setGatewayAdminTools(req.body?.on) });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  post("/api/accounts/gateway-links", (req, res) => {
    if (!requireAccountAdmin(req, res)) return;
    try {
      res.json({
        ok: true,
        gateway: setGatewayLink(
          req.body?.identity,
          typeof req.body?.accountId === "string" ? req.body.accountId : "",
        ),
      });
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

  admin("POST", "/api/accounts/profiles", async (_account, { body }) => {
    try {
      const [profiles, cloud] = await Promise.all([availableProfiles(), cloudProfiles()]);
      return {
        status: 200,
        payload: { ok: true, profile: saveAccessProfile(body, profiles, cloud) },
      };
    } catch (error) {
      return { status: 400, payload: { ok: false, error: error.message } };
    }
  });

  admin("DELETE", "/api/accounts/profiles/:id", (_account, { params }) => {
    try {
      deleteAccessProfile(params.id);
      return { status: 200, payload: { ok: true } };
    } catch (error) {
      return { status: 400, payload: { ok: false, error: error.message } };
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

  admin("PATCH", "/api/accounts/users/:id", async (actor, { params, body = {} }) => {
    try {
      // Each change is explicit: a missing or misspelt field must never re-enable an account.
      let account;
      if (typeof body.accessProfileId === "string")
        account = assignAccessProfile(params.id, body.accessProfileId);
      else if (typeof body.disabled === "boolean")
        account = setAccountDisabled(params.id, body.disabled);
      else if (typeof body.role === "string")
        account = setAccountRole(params.id, body.role, actor?.userId);
      else if (typeof body.password === "string")
        account = await resetAccountPassword(params.id, body.password);
      else
        return {
          status: 400,
          payload: { ok: false, error: "Choose a group, role, account status or password" },
        };
      return { status: 200, payload: { ok: true, account } };
    } catch (error) {
      return { status: 400, payload: { ok: false, error: error.message } };
    }
  });

  admin("DELETE", "/api/accounts/users/:id", (actor, { params }) => {
    try {
      deleteAccount(params.id, actor?.userId);
      return { status: 200, payload: { ok: true } };
    } catch (error) {
      return { status: 400, payload: { ok: false, error: error.message } };
    }
  });
}
