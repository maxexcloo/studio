// Studio MCP at /mcp: authentication, a server per request with the actor's tools, the result, upload and export links, and Studio Chat's in-process agent.
import crypto from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { hostAllowed, hostnameOf } from "../request-guard.js";
import { maxJobsPerCall } from "./controls.js";
import { McpMedia, maxUploadMegabytes, uploadPage } from "./media.js";
import { livePrompting } from "../profile/store.js";
import { gatewaySettings } from "../assistant.js";
import { mayUseFeature } from "../account-policy.js";
import { createChatAssistantMemory, registerAssistantTools } from "./assistant.js";
import { adminInstructions, registerAdminTools } from "./admin.js";
import { registerManageTools } from "./manage.js";
import { registerGenerateTools } from "./generate.js";
import { registerResultTools } from "./results.js";
import { controlInstructions, registerGpuTools } from "./gpu.js";
import fs from "node:fs";
import { appVersion } from "../data-dir.js";

// The generate tool waits up to this long, and only when Studio's estimate says the set finishes within it; otherwise its links return at once.
export const generateWaitSeconds = 30;
// How long generate reads the first job for its end time while the queue picks it up.
const etaProbeMilliseconds = 2000;
// An identical generate from the same conversation within this window is the same request (see generate).
const generateDedupeWindowMs = 120_000;
// Every client gets the same workflow rules from Studio itself, so a client needs no prompt prefix; tool descriptions
// and each reply carry the details, so hosts that resend these every step stay small.
const tierWords =
  '"turbo", "super fast" or "draft" → turbo; "fast" or "quick" → fast; "best" or "high quality" → quality; else omit';
const mediaInstructions = `Studio makes images and videos. Always write finished generate prompts yourself to the model's prompting guide (sent once, with models or a model's first generate), keeping the user's subject and their own descriptive wording (face, body, skin, outfit) verbatim in later prompts, changing only what they ask; pass them as prompts and the user's words as request. Studio runs them exactly as written. Without a number, make 2–4 variations to pick from, and keep a follow-up's count. Choose the model, size, count and LoRAs yourself from the request, guides and the user's taste (thumbs-up LoRAs first) and say briefly what you chose and why; once the user declines LoRAs, pass loras: [] for the rest of the chat. "N sets of K" is N distinct prompts with count K in one call; asked for variety, vary framing, angle, pose, outfit and setting between them. For distinct prompts pass a short set title and titles, one each. To suggest first, call generate with preview and wait for the user. Set kind, and tier only when asked (${tierWords}). "16:9" is aspect, "2K" resolution. Ordinary requests need no models call. For what is ready, running or installed now call models, for work in progress queue; never answer from memory or an earlier reply. For a follow-up on a result ("again", "warmer", "with another model", "animate it"), call reuse with its ref and your revised prompt, not a new generate. To find earlier work, call search. For an attached image, call upload_link; once the user uploads it, generate takes its reference_asset_id. To animate or extend, pass reuse a fitting theme (custom: request is the motion) and name the others. Reply briefly as each result says; if queued, share the links and end the turn. Call result only when the user asks to see results, never in the background. Never poll, resubmit or invent results. Stopped or Offline models still queue. If a named model is unavailable, say so; don't substitute. Call review only when asked to judge, compare or improve images.`;
const unlinkedMessage =
  "This chat account isn’t linked to a Studio account yet. Ask an administrator to link it in Settings › Users.";
const anonymousMessage = "The gateway must forward its user identity.";
/** Schema refusals arrive as one issue per line ("Too big: … at wait_seconds"); one line naming each field is enough to fix the call. */
const conciseError = (message) => {
  const match = /Invalid arguments for tool (\w+): ([\s\S]+)$/.exec(String(message));
  if (!match) return message;
  const issues = match[2]
    .split("\n")
    .filter(Boolean)
    .map((line) => /^(.+) at (\S+)$/.exec(line)?.slice(1).reverse().join(": ") || line);
  // An oversized set is the usual mistake; say how to split it.
  const split = issues.some((issue) => /^(?:count|prompts): Too big/.test(issue))
    ? ` One call queues at most ${maxJobsPerCall} images (prompts × count); split a bigger set into calls made one after another.`
    : "";
  return `Fix the ${match[1]} arguments: ${issues.join("; ")}.${split}`;
};
const equal = (left, right) =>
  Boolean(
    left &&
    right &&
    Buffer.byteLength(left) === Buffer.byteLength(right) &&
    crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right)),
  );
const exportLinkMs = 60 * 60 * 1000;
const exportName = /^studio-profiles-[A-Za-z0-9-]+\.zip$/;
/**
 * Whether a media caller gets the admin tools: an administrator account by its own MCP token, or
 * through the trusted gateway only while Chat Gateway Admin Tools (`gatewayAdminTools()`) is on.
 * Without an account (the shared key in single-user mode) there are none.
 */
export function adminScope({ account, gateway = false, gatewayAdminTools = () => false }) {
  if (account?.role !== "administrator" || account.authenticated === false) return false;
  return gateway ? gatewayAdminTools() === true : true;
}
/** Optional authenticated MCP on the studio's existing HTTP(S) server. */
export function registerMcpRoutes(
  app,
  {
    dataDir,
    // This server's own address, which result links use without STUDIO_MCP_PUBLIC_URL.
    baseUrl,
    environment = process.env,
    // Studio's RuntimeController (runtime/controller.ts), which the control key's tools drive.
    runtime,
    // Each media worker's health and work (runtime/services.ts WorkerStatus), for gpu_status.
    workerStatus = async () => [],
    imageWaitSeconds = generateWaitSeconds,
    etaProbeMs = etaProbeMilliseconds,
    generateDedupeMs = generateDedupeWindowMs,
    allowedHost = (req) => hostAllowed(req.headers.host),
    accountMode = false,
    authenticateAccountToken = () => null,
    authenticateGatewayIdentity = () => null,
    noteGatewayIdentity = () => {},
    resolveSignedResult,
    domainRequest,
    // Failed cloud video jobs updated since a time, as { reason, at }, so a provider refusal pauses cloud video.
    cloudVideoFailures,
    gatewayAdminTools = () => false,
  } = {},
) {
  const mediaKey = environment.STUDIO_MCP_API_KEY;
  const controlKey = environment.CONTROL_MCP_API_KEY;
  // Without a key or accounts nothing is served at /mcp, but Studio Chat still runs the tools in process.
  const served = Boolean(mediaKey || controlKey || accountMode);
  if (controlKey && (!runtime || equal(controlKey, mediaKey)))
    throw new Error(
      "CONTROL_MCP_API_KEY needs Studio runtime control (STUDIO_KUBERNETES_NAMESPACES) and a key separate from STUDIO_MCP_API_KEY.",
    );
  const publicUrl =
    environment.STUDIO_MCP_PUBLIC_URL?.replace(/\/+$/, "") ||
    (typeof baseUrl === "function" ? baseUrl() : baseUrl);
  const parsedPublic = new URL(publicUrl);
  if (
    !["http:", "https:"].includes(parsedPublic.protocol) ||
    parsedPublic.username ||
    parsedPublic.password ||
    parsedPublic.search ||
    parsedPublic.hash
  )
    throw new Error(
      "STUDIO_MCP_PUBLIC_URL must be an absolute HTTP(S) base URL without credentials, query or fragment.",
    );
  // The internet-facing host, when one is configured: there the shared gateway and control keys are
  // refused, even if the host is also allowed privately, and only personal account tokens work.
  const publicHost = environment.STUDIO_MCP_PUBLIC_URL ? hostnameOf(parsedPublic.host) : "";
  // Studio's guide store (guides/prompting.json), reloaded on change.
  const prompting = livePrompting({ dataDir });
  const media = new McpMedia({
    dataDir,
    prompting,
    publicUrl: environment.STUDIO_MCP_PUBLIC_URL
      ? publicUrl
      : () => (typeof baseUrl === "function" ? baseUrl() : baseUrl),
    signingKey: environment.STUDIO_MCP_SIGNING_KEY,
    resolveSignedResult,
    domainRequest,
    cloudVideoFailures,
  });
  const instructions = mediaInstructions;
  // The prompt assistant's tools need its Bifrost gateway; what the chat wrote is remembered for the results' records.
  const assistantGateway = Boolean(gatewaySettings(environment));
  // ... and the account's Prompt Assistant feature (the routes they call refuse without it too).
  const assistantFor = (account) =>
    assistantGateway && (!account || mayUseFeature(account, "promptAssistant"));
  const chatAssistant = createChatAssistantMemory({ dataDir });
  // The studio's rescan or any model change refreshes MCP's per-owner catalogue cache.
  app.use("/api/models", (req, _res, next) => {
    if (req.method !== "GET" ? true : req.path === "/" && req.query.cached !== "1")
      media.invalidateProfiles();
    next();
  });
  const reviewedGuides = new Map();
  // Calls to generate in the dedupe window by conversation and arguments (generate dedupes repeats).
  const recentGenerates = new Map();
  // Previews from generate by conversation and arguments, so the same call without preview queues what was shown.
  const previews = new Map();
  // Stateless transport: a client's notifications/cancelled arrives on its own POST, so waits are found by actor and request id.
  const inflight = new Map();
  // The name each MCP session's client gave on initialize (LibreChat, a Grok connector), so its
  // result sets say where they came from; a session another replica began reads as plain MCP.
  const clientNames = new Map();
  // Studio Chat's in-process client numbers its requests from 0 like any other, so its session
  // keeps a LibreChat cancel from reaching its calls, and the reverse.
  const inflightKey = (actor, requestId) =>
    JSON.stringify([actor.scope, actor.owner, actor.session || "", String(requestId)]);
  const guard = (req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    if (!allowedHost(req) && req.headers.host?.toLowerCase() !== parsedPublic.host.toLowerCase())
      return res.status(403).json({ error: "Unrecognised MCP host." });
    const origin = req.headers.origin;
    if (origin !== undefined) {
      let own;
      try {
        own =
          new URL(origin).origin === parsedPublic.origin ||
          new URL(origin).host.toLowerCase() === req.headers.host?.toLowerCase();
      } catch {
        return res.status(403).json({ error: "Cross-origin MCP requests are not permitted." });
      }
      // A browser-based MCP client (a Grok connector validates its URL from the page) runs cross-origin. MCP
      // takes no ambient credentials — every call carries its bearer token — so a hostile page gains nothing it
      // could not do from its own server; the host check above still stops DNS rebinding.
      if (!own)
        res.set({
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Expose-Headers": "mcp-session-id",
          Vary: "Origin",
        });
    }
    // A bearer header carries the credential; a client that sends no headers (a Grok connector takes only a
    // URL) puts its token in the path instead. Only a personal account token is accepted there: the shared
    // gateway and control keys stay header-only on a private host, so neither a URL nor the internet ever
    // vouches for a gateway or a GPU.
    const bearer = /^Bearer ([^\s]+)$/i.exec(String(req.headers.authorization || ""))?.[1];
    const fromUrl = bearer ? "" : String(req.params.token || "");
    const token = bearer || fromUrl;
    const sharedKeys = !fromUrl && !(publicHost && hostnameOf(req.headers.host) === publicHost);
    const user = String(req.headers["x-ai-user-id"] || "");
    if (user.length > 256 || /[\x00-\x1f\x7f]/.test(user))
      return res.status(400).json({ error: "Invalid forwarded user identity." });
    let account = null;
    let scope = "";
    if (sharedKeys && !accountMode)
      scope = equal(token, mediaKey) ? "media" : equal(token, controlKey) ? "control" : "";
    else if (sharedKeys && equal(token, controlKey)) scope = "control";
    else if (sharedKeys && equal(token, mediaKey)) {
      // Gateway trust: the shared key vouches for the gateway; only a link (an administrator's, or by matching email) maps its user to an account.
      // The gateway's own health checks and handshakes name no user: they connect and list, and every call is refused.
      const email = String(req.headers["x-ai-user-email"] || "");
      if (email.length > 256 || /[\x00-\x1f\x7f]/.test(email))
        return res.status(400).json({ error: "Invalid forwarded user email." });
      account = user ? authenticateGatewayIdentity(user, email) : null;
      if (!user) scope = "anonymous";
      else if (account) {
        scope = "media";
        media.credentials.set(account.userId, { internal: true });
      } else {
        // Listed tools that each explain the missing link read better in a chat than a refused connection.
        noteGatewayIdentity(user);
        scope = "unlinked";
      }
    } else {
      account = authenticateAccountToken(token);
      if (account) {
        scope = "media";
        media.credentials.set(account.userId, { token });
      }
    }
    if (!scope)
      return res
        .status(401)
        .set("WWW-Authenticate", 'Bearer realm="Studio MCP"')
        .json({ error: "A valid MCP bearer credential is required." });
    const conversation = String(req.headers["x-studio-conversation-id"] || "");
    if (conversation.length > 256 || /[\x00-\x1f\x7f]/.test(conversation))
      return res.status(400).json({ error: "Invalid conversation identity." });
    // The MCP session id handed out on initialize (see handle), which a client resends for that chat.
    const session = String(req.headers["mcp-session-id"] || "");
    if (session.length > 256 || /[^\x21-\x7e]/.test(session))
      return res.status(400).json({ error: "Invalid MCP session id." });
    const owner = account?.userId || (scope === "media" ? media.owner(user, token) : null);
    // Result numbers ("result 3") are per conversation: the one the client names (LibreChat), else its MCP
    // session (a client that sends no headers, such as Grok), else the account's.
    const chat = conversation || (session && `mcp-session:${session}`);
    const assistant = scope === "media" && assistantFor(account);
    // Admin tools: an administrator's own MCP token, or a gateway-linked administrator while
    // Chat Gateway Admin Tools is on. Ordinary accounts, the shared key alone and the control key never.
    const admin =
      scope === "media" &&
      adminScope({ account, gateway: equal(token, mediaKey), gatewayAdminTools });
    req.mcpActor = {
      scope,
      owner,
      assistant,
      admin,
      conversation,
      client: clientNames.get(session) || "",
      refs: scope === "media" && owner ? media.referenceScope(owner, chat) : "",
    };
    next();
  };
  const create = (actor) => {
    const { scope, owner, refs } = actor;
    const tool = (server, name, title, description, inputSchema, action, annotations = {}) =>
      server.registerTool(
        name,
        {
          title,
          description,
          inputSchema,
          // MCP reads a tool as not read-only, and then destructive, unless told otherwise.
          annotations: annotations.readOnlyHint
            ? annotations
            : { destructiveHint: false, ...annotations },
        },
        async (args, extra = {}) => {
          // The SDK aborts extra.signal when the client disconnects; a cancellation notification aborts it here.
          const controller = new AbortController();
          const forward = () => controller.abort();
          if (extra.signal?.aborted) controller.abort();
          else extra.signal?.addEventListener("abort", forward, { once: true });
          const key = extra.requestId === undefined ? null : inflightKey(actor, extra.requestId);
          if (key) inflight.set(key, controller);
          try {
            if (scope === "unlinked") throw new Error(unlinkedMessage);
            if (scope === "anonymous") throw new Error(anonymousMessage);
            return await action(args, controller.signal);
          } catch (error) {
            return {
              isError: true,
              content: [
                { type: "text", text: error?.message || "Studio could not complete this request." },
              ],
            };
          } finally {
            extra.signal?.removeEventListener("abort", forward);
            if (key && inflight.get(key) === controller) inflight.delete(key);
          }
        },
      );
    const resolve = (value) => media.resolve(owner, refs, value);
    const server = new McpServer(
      // The commit the image was built from, so a client sees when Studio (and its tools) changed.
      { name: "Studio", version: appVersion || "development" },
      {
        instructions:
          scope === "control"
            ? controlInstructions
            : actor.admin
              ? `${instructions} ${adminInstructions}`
              : instructions,
      },
    );
    const toolError = server.createToolError.bind(server);
    server.createToolError = (message) => toolError(conciseError(message));
    if (scope === "media" || scope === "unlinked" || scope === "anonymous") {
      const { namedInTier } = registerGenerateTools({
        tool,
        server,
        media,
        actor,
        resolve,
        publicUrl,
        imageWaitSeconds,
        etaProbeMs,
        generateDedupeMs,
        reviewedGuides,
        recentGenerates,
        previews,
        chatAssistant,
      });
      registerResultTools({ tool, server, media, actor, resolve });
      registerManageTools({ tool, server, media, owner, refs, resolve });
      if (actor.admin)
        registerAdminTools({
          tool,
          server,
          media,
          owner,
          resolve,
          signExport: (name) => signExport(name),
        });
      if (actor.assistant)
        registerAssistantTools({
          tool,
          server,
          media,
          owner,
          memory: chatAssistant,
          profileOf: async (value) =>
            namedInTier(await media.profiles("all", owner), value).profile,
        });
    } else registerGpuTools({ tool, server, runtime, workerStatus });
    return server;
  };
  const handle = async (req, res) => {
    for (const message of [req.body].flat())
      if (
        message?.method === "notifications/cancelled" &&
        message.params?.requestId !== undefined
      ) {
        inflight.get(inflightKey(req.mcpActor, message.params.requestId))?.abort();
      }
    const server = create(req.mcpActor);
    // Stateless, but initialize hands out a session id: the client resends it on each call from that
    // chat, and the guard scopes result numbers by it. Studio keeps no session state, so any replica
    // serves it, also after a restart.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: [req.body].flat().some(isInitializeRequest)
        ? () => crypto.randomUUID()
        : undefined,
      enableJsonResponse: true,
    });
    res.once("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      const name = [req.body]
        .flat()
        .find(isInitializeRequest)
        ?.params.clientInfo?.name?.replace(/[\x00-\x1f\x7f]+/g, " ")
        .trim()
        .slice(0, 40);
      if (name && transport.sessionId) {
        if (clientNames.size >= 1000) clientNames.delete(clientNames.keys().next().value);
        clientNames.set(transport.sessionId, name);
      }
    } catch {
      if (!res.headersSent)
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "MCP could not complete this request." },
          id: req.body?.id ?? null,
        });
    }
  };
  // A browser-based MCP client must preflight before it may send its JSON; that needs no credential.
  const preflight = (req, res) =>
    res
      .set({
        "Access-Control-Allow-Headers":
          "accept, authorization, content-type, mcp-protocol-version, mcp-session-id",
        "Access-Control-Allow-Methods": "DELETE, GET, OPTIONS, POST",
        "Access-Control-Allow-Origin": req.headers.origin || "*",
        "Access-Control-Expose-Headers": "mcp-session-id",
        "Access-Control-Max-Age": "600",
        "Cache-Control": "private, no-store",
        Vary: "Origin",
      })
      .status(204)
      .end();
  if (served) {
    // A client probing for OAuth (the MCP auth spec's discovery) gets a plain miss, never the app page.
    for (const route of [
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-protected-resource",
    ])
      app.all(route, (_req, res) =>
        res
          .status(404)
          .json({ error: "Studio MCP takes a bearer credential; there is no OAuth here." }),
      );
    // The same endpoint at /mcp/<token> is a full MCP URL of its own, for clients that can send no headers.
    for (const route of ["/mcp", "/mcp/:token"]) {
      app.options(route, preflight);
      app.post(route, guard, express.json({ limit: "30mb" }), handle);
      app.all(route, guard, (_req, res) =>
        res.status(405).set("Allow", "POST").json({ error: "Use Streamable HTTP POST for MCP." }),
      );
    }
  }
  // The export tool's signed bundle links (mcp-admin.js): the file Library › Profiles › Download All wrote, for an hour.
  const exportsDir = dataDir ? path.join(dataDir, "exports") : "";
  function signExport(name, now = Date.now()) {
    const expiresAt = new Date(now + exportLinkMs).toISOString();
    const claims = Buffer.from(JSON.stringify({ n: name, e: now + exportLinkMs })).toString(
      "base64url",
    );
    return {
      url: `${publicUrl}/mcp/exports/${claims}.${media.digest(`export:${claims}`)}`,
      expiresAt,
    };
  }
  if (exportsDir)
    app.get("/mcp/exports/:token", (req, res) => {
      try {
        if (
          !allowedHost(req) &&
          req.headers.host?.toLowerCase() !== parsedPublic.host.toLowerCase()
        )
          throw new Error("Invalid host.");
        const [claims, signature] = String(req.params.token).split(".");
        if (!claims || !equal(signature, media.digest(`export:${claims}`)))
          throw new Error("Invalid link.");
        const { n: name, e: expires } = JSON.parse(Buffer.from(claims, "base64url").toString());
        if (!exportName.test(String(name)) || !(Number(expires) > Date.now()))
          throw new Error("Expired.");
        const archive = fs.readFileSync(path.join(exportsDir, name));
        res
          .set({
            "Cache-Control": "private, no-store",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="${name}"`,
          })
          .send(archive);
      } catch {
        res.status(404).json({ error: "The export link is invalid, unavailable or expired." });
      }
    });
  // The upload_link tool's page, under /mcp/results so the public result route reaches it: the link is the
  // credential, so no Studio sign-in; it takes one image for its owner, then closes.
  app.all("/mcp/results/upload/:token", async (req, res) => {
    const send = (status, page) =>
      res
        .status(status)
        .set({
          "Cache-Control": "private, no-store",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
          "Content-Type": "text/html; charset=utf-8",
        })
        .send(uploadPage(page));
    let claims;
    try {
      if (!allowedHost(req) && req.headers.host?.toLowerCase() !== parsedPublic.host.toLowerCase())
        throw new Error("Invalid host.");
      if (!["GET", "POST"].includes(req.method)) throw new Error("Unsupported method.");
      claims = media.uploadClaims(req.params.token);
    } catch {
      return send(404, {
        message: "This upload link has been used or has expired. Ask the chat for a new one.",
        open: false,
      });
    }
    if (req.method === "GET") return send(200, {});
    // At most the largest image and its form; a body without a length is refused before it is read.
    const length = Number(req.headers["content-length"]);
    if (!(length > 0) || length > maxUploadMegabytes * 1_000_000 + 100_000)
      return send(413, { message: `The photo must be at most ${maxUploadMegabytes} MB.` });
    try {
      const form = await new Request("http://upload.invalid/", {
        method: "POST",
        headers: { "content-type": String(req.headers["content-type"] || "") },
        body: Readable.toWeb(req),
        duplex: "half",
      }).formData();
      const file = form.get("image");
      if (!(file instanceof Blob) || !file.size)
        return send(400, { message: "Choose a photo to upload." });
      await media.uploadByLink(
        claims,
        { buffer: Buffer.from(await file.arrayBuffer()), name: file.name || "photo" },
        accountMode ? { internal: true } : undefined,
      );
      return send(201, { message: "Uploaded — go back to the chat.", open: false });
    } catch (error) {
      return send(400, {
        message: error?.message || "Studio could not save this photo.",
        open: media.uploadLinks.has(claims.nonce),
      });
    }
  });
  app.get("/mcp/results/:token", async (req, res) => {
    try {
      if (!allowedHost(req) && req.headers.host?.toLowerCase() !== parsedPublic.host.toLowerCase())
        throw new Error("Invalid host.");
      const claims = media.claims(req.params.token);
      if (claims.page || claims.all) {
        // Account mode reads as the signed owner with Studio's own credential; the call rechecks that account's access.
        const credential = accountMode ? { internal: true } : undefined;
        const html = claims.all
          ? await media.allPage(claims, credential)
          : await media.page(claims, credential);
        if (!html) throw new Error("Unavailable.");
        return res
          .set({
            "Cache-Control": "private, no-store",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy":
              "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
            "Content-Type": "text/html; charset=utf-8",
          })
          .send(html);
      }
      const read = (jobId, index) =>
        accountMode
          ? media.signedResult(claims.owner, jobId, index)
          : media.download(claims.owner, jobId, index);
      const result = claims.sheet
        ? await media.sheet(claims.sheet, read)
        : claims.preview
          ? await media.previewOf(await read(claims.jobId, claims.index))
          : await read(claims.jobId, claims.index);
      res
        .set({
          "Cache-Control": "private, no-store",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": "inline",
          "Content-Type": result.mime,
        })
        .send(result.content);
    } catch {
      res.status(404).json({ error: "The result link is invalid, unavailable or expired." });
    }
  });
  /**
   * Studio Chat's agent for one chat: the same server, instructions and tools an MCP client gets,
   * connected in process. Its work joins the chat (`session`), the chat's earlier results get refs
   * ("result 1") in order and its references become the owner's, so tools can use them.
   */
  async function agent({ owner, account, session, jobs = [], assets = [] }) {
    if (account) media.credentials.set(owner, { internal: true });
    const conversation = `studio-chat:${session}`;
    const refs = media.referenceScope(owner, conversation);
    media.adopt(owner, refs, { jobs, assets });
    const server = create({
      scope: "media",
      owner,
      conversation,
      refs,
      session,
      assistant: assistantFor(account),
      // As for a chat gateway's linked account: administrators while Chat Gateway Admin Tools is on.
      admin: adminScope({ account, gateway: true, gatewayAdminTools }),
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "Studio Chat", version: "1.0.0" });
    await server.connect(serverSide);
    await client.connect(clientSide);
    const { tools } = await client.listTools();
    return {
      instructions: client.getInstructions() || "",
      tools,
      refOf: (jobId) => media.refOf(owner, refs, jobId),
      // Prompt writing and Studio's estimate run inside a call, so it may take minutes.
      call: (name, args, signal) =>
        client.callTool({ name, arguments: args }, undefined, { signal, timeout: 10 * 60_000 }),
      close: () => client.close(),
    };
  }
  return { agent, endWaits: () => media.endWaits() };
}
