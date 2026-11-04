// SPDX-License-Identifier: AGPL-3.0-only
// Native port of the Studio MCP service; see mcp.LICENSE.
import crypto from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { hostAllowed } from "../request-guard.js";
import {
  closest,
  listedControls,
  loraIndex,
  loraQueryWords,
  mcpControls,
  mcpGenerationCount,
  mcpLoras,
  mcpSize,
} from "./controls.js";
import {
  McpMedia,
  assertJobCount,
  maxJobsPerCall,
  mcpJson,
  maxUploadBase64,
  maxUploadMegabytes,
  mcpOutputPath,
  replyRule,
  uploadLinkMinutes,
  uploadPage,
} from "./media.js";
import { exactPromptInstructions, fullBodyPerson } from "./prompt-checks.js";
import { canonicalProfileId, livePrompting } from "../profile/store.js";
import {
  asksForCloud,
  familyMatches,
  fastestFirst,
  findProfile,
  isCloudProfile,
  localUnlessAsked,
  mcpTiers,
  nameWords,
  profileFromRequest,
  serviceState,
  stoppedServices,
  speedWordList,
  profilesForTier,
  profilesNearTier,
  searchProfiles,
  tierOf,
  withinFamily,
} from "./tiers.js";
import { animateThemes } from "../prompt-animate.js";
import { gatewaySettings } from "../assistant.js";
import { mayUseFeature } from "../account-policy.js";
import { createChatAssistantMemory, registerAssistantTools } from "./assistant.js";
import { adminInstructions, registerAdminTools } from "./admin.js";
import { registerManageTools } from "./manage.js";
import fs from "node:fs";
import { imageMimes } from "../reference-names.js";
import { appVersion } from "../data-dir.js";
import { accessFeatures } from "../account-policy.js";

// Generate waits up to this long, and only when Studio's estimate says the set finishes within it; otherwise its links return at once.
export const generateWaitSeconds = 30;
// How long Generate reads the first job for its end time while the queue picks it up.
const etaProbeMilliseconds = 2000;
// An identical Generate from the same conversation within this window is the same request (see Generate).
const generateDedupeWindowMs = 120_000;
// A preview's prompts wait this long for the user's go-ahead.
const previewMs = 30 * 60 * 1000;
/** A set's expected wait for the reply: "about 40 s", "about 3 min". */
const aboutTime = (ms) =>
  ms < 55_000
    ? `about ${Math.max(5, Math.round(ms / 5000) * 5)} s`
    : ms < 90 * 60_000
      ? `about ${Math.round(ms / 60_000)} min`
      : `about ${Math.round(ms / 3_600_000)} h`;
/** JSON with sorted keys and undefined left out, so equal arguments give equal text. */
const stableJson = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .filter((name) => item[name] !== undefined)
            .map((name) => [name, item[name]]),
        )
      : item,
  );
// Every client gets the same workflow rules from Studio itself, so a client needs no prompt prefix; tool descriptions
// and each reply carry the details, so hosts that resend these every step stay small.
const tierWords =
  '"turbo", "super fast" or "draft" → turbo; "fast" or "quick" → fast; "best" or "high quality" → quality; else omit';
const mediaInstructions = `Studio makes images and videos. Always write finished Generate prompts yourself to the model's prompting guide (sent once, with Models or a model's first Generate), keeping the user's subject; pass them as prompts and the user's words as request. Studio runs them exactly as written. count is images per prompt; without a number, make 2–4 variations to pick from, and keep a follow-up's count. Choose the model, size, count and LoRAs yourself from the request, guides and the user's taste (thumbs-up LoRAs first) and say briefly what you chose and why. "N sets of K" is N distinct prompts with count K in one call. To suggest first, call Generate with preview and wait for the user. Set kind, and tier only when asked (${tierWords}). "16:9" is aspect, "2K" resolution; upscale only when the user asks to upscale or enlarge. Ordinary requests need no Models call. Tools and these instructions name no models, workers, LoRAs or features, as those change: for what is ready, running or installed now call Models, for work in progress Queue; never answer from memory or an earlier reply. For a follow-up on a result ("again", "warmer", "with another model", "animate it"), call Reuse with its ref and your revised prompt, not a new Generate. To find earlier work, call Search. For an attached image, call UploadLink. To animate or extend, pass Reuse a fitting theme (custom: request is the motion) and name the others. Reply briefly as each result says; if queued, share the links and end the turn. Call Result only when the user asks to see results, never in the background. Never poll, resubmit or invent results. If a named model is unavailable, say so; don't substitute. Call Review only when asked to judge, compare or improve images.`;
const controlInstructions =
  "GPU placement is manual: use these tools only on explicit request, and present a Preview or Mode preview and get approval before Apply. Restart only what the user names. Media generation never changes the placement.";
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
// Status and Result wait briefly at most: a chat waiting on a tool blocks its turn.
const wait = z.number().int().min(0).max(20).default(0);
const job = {
  job_id: z.string().min(1).max(200).describe('A ref such as "result 3", or a job_id.'),
};
const output = { ...job, output_index: z.number().int().min(0).max(999).default(0) };
// A free string checked here, so a call with a tier this deployment doesn't have gets the current list.
const tier = z
  .string()
  .trim()
  .toLowerCase()
  .refine((value) => mcpTiers.includes(value), {
    message: `Use one of ${mcpTiers.join(", ")}`,
  })
  .describe(`One of ${mcpTiers.join(", ")}; turbo is Super Fast.`);
// The animation themes Reuse takes, checked at call time like tier.
const theme = z
  .string()
  .trim()
  .toLowerCase()
  .refine((value) => Object.hasOwn(animateThemes, value), {
    message: `Use one of ${Object.keys(animateThemes).join(", ")}`,
  })
  .describe(`One of ${Object.keys(animateThemes).join(", ")}.`);
const jobCount = z.number().int().min(1).max(maxJobsPerCall);
const promptList = z.array(z.string().trim().min(1)).min(1).max(maxJobsPerCall);
/** A JSON array sent as one string, or a single prompt. */
const promptListText = z.string().transform((text) => {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [text];
  } catch {
    return [text];
  }
});
// Models shows a guide's gist; a model's first Generate sends the whole guide for the chat to write to.
const maxShownGuideCharacters = 500;
const maxListedLoras = 30;
/**
 * A profile guide as one paragraph: the family's summary, rules, pitfalls and example, then its
 * mode's and variant's, without sources; `max` caps it for a preview.
 */
function compactGuide(guide, max = Infinity) {
  if (!guide || typeof guide !== "object") return "";
  const parts = [];
  const add = (value) => {
    for (const item of [value].flat())
      if (typeof item === "string" && item.trim()) parts.push(item.replace(/\s+/g, " ").trim());
  };
  for (const source of [guide, guide.mode, guide.variant])
    if (source && typeof source === "object") {
      add(source.summary);
      add(source.rules);
      add(source.pitfalls);
      if (source.example)
        add(
          `Example: ${typeof source.example === "string" ? source.example : JSON.stringify(source.example)}`,
        );
    }
  const textValue = parts.join(" ");
  return textValue.length > max ? `${textValue.slice(0, max - 1)}…` : textValue;
}
// The prompt a result ran, as the chat shows it; the result page has the full text.
const maxShownPromptCharacters = 200;
const shortPrompt = (prompt) => {
  const flat = String(prompt).replace(/\s+/g, " ").trim();
  return (
    flat.length > maxShownPromptCharacters
      ? `${flat.slice(0, maxShownPromptCharacters - 1)}…`
      : flat
  ).replace(/[\\`*_[\]<>#|]/g, "\\$&");
};
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
    baseUrl,
    environment = process.env,
    // Studio's RuntimeController (runtime/controller.ts), which the control key's tools drive.
    runtime,
    imageWaitSeconds = generateWaitSeconds,
    etaProbeMs = etaProbeMilliseconds,
    generateDedupeMs = generateDedupeWindowMs,
    fetchImpl = fetch,
    allowedHost = (req) => hostAllowed(req.headers.host),
    accountMode = false,
    authenticateAccountToken = () => null,
    authenticateGatewayIdentity = () => null,
    noteGatewayIdentity = () => {},
    internalCredential = () => ({}),
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
  // Studio's guide store (guides/prompting.json), reloaded on change.
  const prompting = livePrompting({ dataDir });
  const media = new McpMedia({
    dataDir,
    prompting,
    baseUrl,
    publicUrl: environment.STUDIO_MCP_PUBLIC_URL
      ? publicUrl
      : () => (typeof baseUrl === "function" ? baseUrl() : baseUrl),
    signingKey: environment.STUDIO_MCP_SIGNING_KEY,
    fetchImpl,
    resolveSignedResult,
    domainRequest,
    cloudVideoFailures,
  });
  const instructions = mediaInstructions;
  // The prompt assistant's tools need its LiteLLM gateway; what the chat wrote is remembered for the results' records.
  const assistantGateway = Boolean(gatewaySettings(environment));
  // ... and the account's Prompt Assistant feature (the routes they call refuse without it too).
  const assistantFor = (account) =>
    assistantGateway && (!account || mayUseFeature(account, "promptAssistant"));
  const chatAssistant = createChatAssistantMemory({
    file: dataDir ? path.join(dataDir, "mcp-assistant.json") : "",
  });
  // The studio's rescan or any model change refreshes MCP's per-owner catalogue cache.
  app.use("/api/models", (req, _res, next) => {
    if (req.method !== "GET" ? true : req.path === "/" && req.query.cached !== "1")
      media.invalidateProfiles();
    next();
  });
  const reviewedGuides = new Map();
  // Generate calls of the dedupe window by conversation and arguments (Generate dedupes repeats).
  const recentGenerates = new Map();
  // Generate previews by conversation and arguments, so the same call without preview queues what was shown.
  const previews = new Map();
  // Stateless transport: a client's notifications/cancelled arrives on its own POST, so waits are found by actor and request id.
  const inflight = new Map();
  // Studio Chat's in-process client numbers its requests from 0 like any other, so its session
  // keeps a LibreChat cancel from reaching its calls, and the reverse.
  const inflightKey = (actor, requestId) =>
    JSON.stringify([actor.scope, actor.owner, actor.session || "", String(requestId)]);
  // A guide goes to each conversation once (each account and profile without a conversation header).
  const guideKey = (refs, profileId) => JSON.stringify([refs, profileId]);
  /** Marks a guide sent and reports whether it was new; synchronous, so concurrent calls attach it once. */
  const review = (refs, profileId) => {
    const key = guideKey(refs, profileId);
    if (reviewedGuides.has(key)) return false;
    if (reviewedGuides.size >= 4096) reviewedGuides.delete(reviewedGuides.keys().next().value);
    reviewedGuides.set(key, Date.now());
    return true;
  };
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
    // gateway and control keys stay header-only, so a URL never vouches for a gateway or a GPU.
    const bearer = /^Bearer ([^\s]+)$/i.exec(String(req.headers.authorization || ""))?.[1];
    const fromUrl = bearer ? "" : String(req.params.token || "");
    const token = bearer || fromUrl;
    const user = String(req.headers["x-ai-user-id"] || "");
    if (user.length > 256 || /[\x00-\x1f\x7f]/.test(user))
      return res.status(400).json({ error: "Invalid forwarded user identity." });
    let account = null;
    let scope = "";
    if (!fromUrl && !accountMode)
      scope = equal(token, mediaKey) ? "media" : equal(token, controlKey) ? "control" : "";
    else if (!fromUrl && equal(token, controlKey)) scope = "control";
    else if (!fromUrl && equal(token, mediaKey)) {
      // Gateway trust: the shared key vouches for the gateway; only a link (an administrator's, or by matching email) maps its user to an account.
      // The gateway's own health checks and handshakes name no user: they connect and list, and every call is refused.
      const email = String(req.headers["x-ai-user-email"] || "");
      if (email.length > 256 || /[\x00-\x1f\x7f]/.test(email))
        return res.status(400).json({ error: "Invalid forwarded user email." });
      account = user ? authenticateGatewayIdentity(user, email) : null;
      if (!user) scope = "anonymous";
      else if (account) {
        scope = "media";
        media.credentials.set(account.userId, internalCredential(account.userId));
      } else {
        // Listed tools that each explain the missing link read better in a chat than a refused connection.
        noteGatewayIdentity(user);
        scope = "unlinked";
      }
    } else {
      account = authenticateAccountToken(token);
      if (account) {
        scope = "media";
        media.credentials.set(account.userId, { Authorization: `Bearer ${token}` });
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
    const owner = account?.userId || (scope === "media" ? media.owner(user, token) : null);
    // Result numbers ("result 3") are per conversation when the client names one, otherwise per account.
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
      refs: scope === "media" && owner ? media.referenceScope(owner, conversation) : "",
    };
    next();
  };
  const create = (actor) => {
    const { scope, owner, refs, conversation } = actor;
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
    /** A submission's reply: finished markdown when every job ends within the wait, otherwise result links for the queued jobs, which end the agent's turn. */
    const respond = async (
      submission,
      profile,
      signal,
      guide = "",
      promptSource = "exact",
      note = "",
    ) => {
      const label = profile.label || profile.id;
      // Iterations that rebuild a whole Generate call drift from the result; Reuse keeps its settings.
      const followUp = `To change or animate one later, call Reuse with its ref (such as "${submission.jobs[0]?.ref || "result 1"}") and your revised prompt.`;
      // A set Studio expects to finish within the wait comes back finished, so the agent needs no Result call;
      // anything longer, or with no trusted estimate, hands back its links at once.
      const [endsAt] = await media.finishTimes(owner, [submission], {
        probeMs: etaProbeMs,
        signal,
      });
      const expected = endsAt === null ? null : Math.max(0, endsAt - Date.now());
      // Studio Chat shows the set as a card that follows it, so its turn never waits.
      const seconds =
        !actor.session && expected !== null && expected <= imageWaitSeconds * 1000
          ? imageWaitSeconds
          : 0;
      // A set that outlasted its wait has no ETA left worth giving.
      const left = seconds ? 0 : expected;
      const markdown = await media.settle(owner, submission, seconds, { scope: refs, signal });
      const structured = {
        status: markdown ? "done" : submission.status,
        profile: {
          id: profile.id,
          label,
          tier: tierOf(profile),
          ...(isCloudProfile(profile) ? { remote: true } : {}),
        },
        prompt_source: promptSource,
        ...(!markdown && left ? { eta_seconds: Math.round(left / 1000) } : {}),
        jobs: submission.jobs.map(({ job_id, ref, link, status }) => ({
          job_id,
          ref,
          link,
          ...(status ? { status } : {}),
        })),
      };
      // The prompt each result ran, shortened; one line when every job shares it.
      const prompted = submission.jobs.filter(({ prompt }) => prompt);
      const distinct = new Set(prompted.map(({ prompt }) => prompt));
      const prompts = !prompted.length
        ? ""
        : `\n\n${distinct.size === 1 ? `Prompt: ${shortPrompt([...distinct][0])}` : prompted.map(({ ref, prompt }) => `${ref[0].toUpperCase()}${ref.slice(1)} prompt: ${shortPrompt(prompt)}`).join("\n")}`;
      // The profile's guide follows its first use in a conversation, so the agent applies it to later prompts.
      const extra = guide
        ? [
            {
              type: "text",
              text: `Prompting guide for ${label} (sent once); apply it to later prompts: ${guide}`,
            },
          ]
        : [];
      // Several results, or any still running, also get one All Results page that fills in as they finish.
      const all = `[All Results](${media.allUrl(owner, refs)})`;
      if (markdown)
        return {
          content: [
            {
              type: "text",
              text: `Done on ${label}. ${note}${replyRule} ${followUp}\n\n${markdown}${submission.jobs.length > 1 ? `\n\n${all}` : ""}${prompts}`,
            },
            ...extra,
          ],
          structuredContent: structured,
        };
      const pending = [
        ...submission.jobs.map(
          ({ ref, link }) => `[${ref[0].toUpperCase()}${ref.slice(1)}](${link})`,
        ),
        all,
      ].join(" · ");
      const message =
        submission.status === "queued"
          ? `Queued on ${label}${left ? `, ready in ${aboutTime(left)}` : ""}. ${note}Share the links below, not images (none exist yet), and end your turn; do not call Result now or in the background. When the user later asks to see results, call Result. Never poll or resubmit. ${followUp}`
          : `${submission.error} ${note}Share the links; never resubmit.`;
      return {
        content: [{ type: "text", text: `${message}\n\n${pending}${prompts}` }, ...extra],
        structuredContent: {
          ...structured,
          ...(submission.error ? { error: submission.error } : {}),
        },
      };
    };
    /**
     * 2–4 single-image sets become one labelled side-by-side page (/compare/:id), or "" when the run doesn't fit
     * one (videos, several images per model, a refused set) or the comparison can't be saved.
     */
    const comparisonOf = async (sets) => {
      const jobs = sets.map(({ queued }) => queued.jobs || []);
      if (
        sets.length < 2 ||
        sets.length > 4 ||
        sets.some(({ profile, queued }) => profile.kind === "video" || queued.error) ||
        jobs.some((list) => list.length !== 1)
      )
        return "";
      try {
        const { id = "" } = await media.request(
          "POST",
          "/api/comparisons",
          {
            jobIds: jobs.map(([job]) => job.job_id),
            labels: sets.map(({ profile }) => (profile.label || profile.id).slice(0, 80)),
          },
          owner,
        );
        return id && `${publicUrl}/compare/${id}`;
      } catch {
        return "";
      }
    };
    /** Several models' sets as one reply: a line of result links per model with its expected wait, without waiting for any. */
    const respondSets = async (sets, note = "", signal, compare = "") => {
      const link = ({ ref, link: url }) => `[${ref[0].toUpperCase()}${ref.slice(1)}](${url})`;
      const now = Date.now();
      const left = (
        await media.finishTimes(
          owner,
          sets.map(({ queued }) => queued),
          { probeMs: etaProbeMs, signal },
        )
      ).map((endsAt) => (endsAt === null ? 0 : Math.max(0, endsAt - now)));
      const lines = sets.map(
        ({ profile, queued }, index) =>
          `${profile.label || profile.id}: ${queued.error || queued.jobs.map(link).join(" · ")}${left[index] ? ` (${aboutTime(left[index])})` : ""}`,
      );
      const first =
        sets.find(({ queued }) => queued.jobs?.length)?.queued.jobs[0].ref || "result 1";
      return {
        content: [
          {
            type: "text",
            text: `Queued ${sets.length} sets, one per model. ${note}Share the links below, not images (none exist yet), and end your turn; do not call Result now or in the background. Never poll or resubmit. To change or animate one later, call Reuse with its ref (such as "${first}") and your revised prompt.${compare ? " Share the comparison link first: it shows every model side by side with the same seed." : ""}\n\n${compare ? `[Compare Side by Side](${compare})\n` : ""}${lines.join("\n")}\n[All Results](${media.allUrl(owner, refs)})`,
          },
        ],
        structuredContent: {
          status: "queued",
          ...(compare ? { compare } : {}),
          sets: sets.map(({ profile, queued }, index) => ({
            profile: { id: profile.id, label: profile.label || profile.id },
            ...(left[index] ? { eta_seconds: Math.round(left[index] / 1000) } : {}),
            jobs: (queued.jobs || []).map(({ job_id, ref, link: url }) => ({
              job_id,
              ref,
              link: url,
            })),
            ...(queued.error ? { error: queued.error } : {}),
          })),
        },
      };
    };
    /** Studio's usual pick; with several to choose from, the note says which. */
    const picked = ({ pool, profile, note }) =>
      pool.length < 2
        ? { profile, note }
        : { profile, note: `${note}Chose ${profile.label || profile.id}, the default. ` };
    /** A named profile, moved to the wanted tier within its family (an exact id stays), with a note when the tier fell back. */
    const namedInTier = (profiles, value, wanted) => {
      // A cloud (Grok) profile only by its exact id or when the name asks for the cloud.
      const found = profileNamed(
        profiles.some((profile) => profile.id === value)
          ? profiles
          : localUnlessAsked(profiles, { name: value }),
        value,
      );
      return found.id === value
        ? { profile: found, note: "" }
        : withinFamily(profiles, found, wanted);
    };
    /**
     * How many references a profile takes, from its graph's media inputs, and per backend where a
     * combined profile's backends differ; its label or description may say otherwise.
     */
    const referenceCount = (profile) => {
      const inputs = profile.mediaInputs || [];
      const backends = (profile.backendOptions || []).filter((option) =>
        Number.isInteger(option.references),
      );
      const differ = new Set(backends.map((option) => option.references)).size > 1;
      return {
        max: inputs.length,
        required: inputs.filter((slot) => slot.required).length,
        ...(differ
          ? {
              by_backend: Object.fromEntries(
                backends.map((option) => [option.label, option.references]),
              ),
            }
          : {}),
        note: "From the profile's graph, so it outranks any count its label or description gives.",
      };
    };
    // A profile whose worker isn't answering, as Settings › Workers names that state.
    const workerState = { parked: "Stopped", offline: "Offline" };
    /** Profiles as Models lists them: "id — label" grouped by kind, marked when their worker isn't running. */
    const listed = (profiles) => {
      const list = {};
      for (const profile of profiles) {
        const state = workerState[profile.availability]
          ? ` (${workerState[profile.availability]})`
          : "";
        (list[profile.kind] ||= []).push(
          `${profile.label && profile.label !== profile.id ? `${profile.id} — ${profile.label}` : profile.id}${state}`,
        );
      }
      return list;
    };
    /** Why the account sees no LoRAs, so an empty list is never read as Studio having none. */
    const noLoras = async ({ profile, taking = false } = {}) => {
      const access = await media.access(owner);
      const label = profile && (profile.label || profile.id);
      const reason =
        access && !access.features.loras
          ? "LoRAs are off for this account (its group doesn't grant them, or its own LoRAs switch in Preferences is off), so none can be listed or used. This doesn't mean Studio has none."
          : profile
            ? listedControls(profile).loras
              ? `No installed LoRA fits ${label}.`
              : `${label} takes no LoRAs.`
            : taking
              ? "No installed LoRA fits this account's ready profiles."
              : "No ready profile takes LoRAs right now, so none can be listed; this doesn't mean Studio has none. Models without lora_query shows each service's state.";
      return { loras: [], loras_note: `${reason}${hiddenLoras(access)}` };
    };
    /** Uncensored LoRAs stay out of an account's lists without Uncensored Models. */
    const hiddenLoras = (access) =>
      access?.features.loras && !access.features.uncensoredModels
        ? " LoRAs marked uncensored stay hidden without Uncensored Models."
        : "";
    /** A lookup that matched none: says so, with how many there are and how to list them. */
    const noMatch = async (query, installed) =>
      `No LoRA matches ${query ? `"${query}"` : "those names"}, but ${installed} ${installed === 1 ? "is" : "are"} installed for this account. Call Models with lora_query "all" to list them, or try other words.${hiddenLoras(await media.access(owner))}`;
    /** One page of LoRA index lines. */
    const lorasPage = async (lines, number, installed) => {
      const pages = Math.max(1, Math.ceil(lines.length / maxListedLoras));
      const at = Math.min(number, pages);
      return {
        loras: lines.slice((at - 1) * maxListedLoras, at * maxListedLoras),
        loras_installed: installed,
        page: at,
        pages,
        loras_note: `Each reads name — hint [trigger word].${at < pages ? ` Call Models again with lora_page ${at + 1} for more.` : ""} Pass names to Generate; Studio adds missing trigger words.${hiddenLoras(await media.access(owner))}`,
      };
    };
    /** A ready profile by id or name, the fastest of one family's matches; otherwise the closest few, fastest first, so one call corrects a guess. */
    const profileNamed = (profiles, value) => {
      const found = findProfile(profiles, value);
      if (found) return found;
      // Words that name several models ("klein" for FLUX.2 and FLUX.3) list them, so one more call picks one.
      const matches = searchProfiles(profiles, value);
      if (matches.length > 1)
        throw new Error(
          `${value} matches several profiles: ${matches
            .slice(0, 6)
            .map((profile) => `${profile.id} (${profile.label || profile.id})`)
            .join(", ")}. Pass one id.`,
        );
      // A miss lists only the family the name points at; another model is never offered as a stand-in.
      const family = familyMatches(profiles, value);
      if (family.length)
        throw new Error(
          `No ready profile matches ${value}. Ready profiles for it: ${family
            .slice(0, 6)
            .map((profile) => `${profile.id} (${profile.label || profile.id})`)
            .join(", ")}.`,
        );
      if (nameWords(value).some((word) => !speedWordList.has(word)))
        throw new Error(
          `No ready profile matches ${value}; that model isn't available to this account. Tell the user instead of using another model.`,
        );
      const near = closest(fastestFirst(profiles), value, (profile) => [
        profile.id,
        profile.label,
        tierOf(profile),
      ]);
      throw new Error(
        `No ready profile matches ${value}.${near.length ? ` Closest: ${near.map((profile) => `${profile.id} (${profile.label || profile.id})`).join(", ")}.` : " Call Models for the list."}`,
      );
    };
    /**
     * Queues a submission with the request behind it. The profile's guide goes to a conversation that has
     * not had it, marked before any wait, so the chat writes its later prompts itself.
     */
    const submit = async (profile, args, record = {}, { guide = true } = {}) => {
      const fresh = guide && review(refs, profile.id);
      try {
        const queued = await media.queue(owner, args, refs, {
          ...record,
          ...(actor.session ? { session: actor.session } : conversation ? { conversation } : {}),
        });
        return { queued, guide: fresh ? compactGuide(profile.prompting) : "" };
      } catch (error) {
        // A refused submission delivered no guide, so the next attempt carries it.
        if (fresh) reviewedGuides.delete(guideKey(refs, profile.id));
        throw error;
      }
    };
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
      tool(
        server,
        "Models",
        "Find Models",
        "What Studio has now. Without profile_id: ready profiles as \"id — label\" by kind (Stopped or Offline marked), those needing setup, each service's state and the account's features. With profile_id (id, label or words): its guide's gist, defaults, controls, references and LoRAs. lora_query or lora_names look up LoRAs, in every profile without profile_id; lora_page pages.",
        {
          kind: z.enum(["all", "image", "video"]).default("all"),
          tier: tier.optional(),
          profile_id: z.string().optional(),
          lora_query: z
            .string()
            .max(200)
            .optional()
            .describe('Words from a LoRA\'s name, title or trigger; "all" lists every one.'),
          // Clients validate against the published schema, so extra names are dropped here, not rejected.
          lora_names: z
            .array(z.string().min(1))
            .transform((names) => names.slice(0, 5))
            .optional(),
          lora_page: z.number().int().min(1).max(1000).default(1),
          full_guide: z
            .boolean()
            .optional()
            .describe("The whole prompting guide; rarely needed beyond its gist."),
        },
        async ({
          kind,
          tier: wanted,
          profile_id: named_id,
          lora_query,
          lora_names = [],
          lora_page,
          full_guide,
        }) => {
          const profile_id = canonicalProfileId(named_id);
          let profiles = await media.profiles(kind, owner);
          if (profile_id === undefined) {
            // Cloud (Grok) profiles list apart: Generate uses one only when the user asks for Grok or the cloud.
            const cloud = profiles.filter(isCloudProfile);
            profiles = profiles.filter((profile) => !isCloudProfile(profile));
            if (wanted) profiles = profilesNearTier(profiles, wanted);
            // A LoRA lookup without a model searches every ready profile, so one call answers it.
            if (lora_query !== undefined || lora_names.length) {
              const infos = await media.loraInfos(owner);
              const ratings = await media.loraRatings(owner);
              const taking = profiles.filter((profile) => listedControls(profile).loras);
              const installed = new Set(taking.flatMap((profile) => profile.options?.loras || []));
              if (!installed.size) return mcpJson(await noLoras({ taking: taking.length > 0 }));
              // A general lookup ("lora", "all") lists every LoRA, a page at a time.
              if (!loraQueryWords(lora_query).length && !lora_names.length) {
                const lines = new Map();
                for (const profile of taking)
                  for (const { name, line } of loraIndex(profile, infos, ratings))
                    if (!lines.has(name)) lines.set(name, line);
                return mcpJson(await lorasPage([...lines.values()], lora_page, installed.size));
              }
              const found = new Map();
              const missing = new Set(lora_names);
              for (const profile of taking) {
                const result = mcpLoras(profile, infos, {
                  query: lora_query,
                  names: lora_names,
                  ratings,
                });
                for (const lora of result.loras) {
                  if (!found.has(lora.name)) found.set(lora.name, { ...lora, profiles: [] });
                  found.get(lora.name).profiles.push(profile.id);
                }
                for (const value of lora_names)
                  if (!result.missing?.some((item) => item.name === value)) missing.delete(value);
              }
              return mcpJson({
                loras: [...found.values()].slice(0, maxListedLoras),
                ...(missing.size ? { missing: [...missing] } : {}),
                loras_installed: installed.size,
                loras_note: found.size
                  ? "Pass names to Generate without profile_id and Studio picks a profile that takes them all."
                  : await noMatch(lora_query, installed.size),
              });
            }
            const catalogue = await media.catalogue(owner);
            const access = await media.access(owner);
            const shown = (value) => kind === "all" || kind === value;
            const services = catalogue.backends
              ? Object.fromEntries(
                  ["image", "video"]
                    .filter(shown)
                    .map((value) => [value, serviceState(catalogue.backends[value])]),
                )
              : null;
            const inState = (state) =>
              Object.keys(services || {}).filter((value) => services[value] === state);
            const servicesNote = [
              inState("Stopped").length ? stoppedServices(inState("Stopped")) : "",
              inState("Offline").length
                ? `${inState("Offline")
                    .map((value) => (value === "image" ? "Images" : "Videos"))
                    .join(" and ")} are Offline: the worker isn't answering; try again later.`
                : "",
            ]
              .filter(Boolean)
              .join(" ");
            const unready = (catalogue.profiles || []).filter(
              (profile) => profile.ready === false && shown(profile.kind),
            );
            return mcpJson({
              ...listed(profiles),
              ...(cloud.length
                ? {
                    cloud: listed(cloud),
                    cloud_note: "Only when the user asks for Grok or the cloud.",
                  }
                : {}),
              ...(unready.length
                ? {
                    needs_setup: Object.fromEntries(
                      unready.map((profile) => [
                        profile.id,
                        profile.readyReason || "Its files or nodes aren't ready.",
                      ]),
                    ),
                  }
                : {}),
              ...(services ? { services } : {}),
              ...(servicesNote ? { services_note: servicesNote } : {}),
              ...(access
                ? {
                    account: {
                      role: access.role,
                      features: accessFeatures.filter((feature) => access.features[feature]),
                    },
                  }
                : {}),
            });
          }
          if (!profiles.some((profile) => profile.id === profile_id))
            profiles = localUnlessAsked(profiles, { name: profile_id });
          // Words that name several models ("klein", "flux") list them instead of choosing one.
          const named = findProfile(profiles, profile_id);
          const matches = named
            ? []
            : searchProfiles(wanted ? profilesNearTier(profiles, wanted) : profiles, profile_id);
          if (matches.length > 1) return mcpJson(listed(matches));
          const { profile, note: tierNote } = named
            ? named.id === profile_id
              ? { profile: named, note: "" }
              : withinFamily(profiles, named, wanted)
            : namedInTier(profiles, profile_id, wanted);
          const infos =
            profile.options?.loras?.length && profile.capabilities?.lora !== false
              ? await media.loraInfos(owner)
              : {};
          const ratings = Object.keys(infos).length ? await media.loraRatings(owner) : {};
          const controls = listedControls(profile);
          // A LoRA lookup answers only that question; the profile's guide and controls come without one.
          if (lora_query !== undefined || lora_names.length) {
            if (!controls.loras || !profile.options?.loras?.length)
              return mcpJson({ id: profile.id, ...(await noLoras({ profile })) });
            if (!loraQueryWords(lora_query).length && !lora_names.length)
              return mcpJson({
                id: profile.id,
                ...(await lorasPage(
                  loraIndex(profile, infos, ratings).map(({ line }) => line),
                  lora_page,
                  profile.options.loras.length,
                )),
              });
            const { loras, total, more, missing } = mcpLoras(profile, infos, {
              query: lora_query,
              names: lora_names,
              ratings,
            });
            return mcpJson({
              id: profile.id,
              loras,
              loras_total: total,
              ...(more ? { more_matches: more } : {}),
              ...(missing ? { missing } : {}),
              ...(loras.length ? {} : { loras_note: await noMatch(lora_query, total) }),
            });
          }
          review(refs, profile.id);
          // Defaults only for adjustable controls: a fixed value is not something to choose.
          const defaults = Object.fromEntries(
            Object.entries({ ...profile.defaults, count: mcpGenerationCount }).filter(
              ([key]) => controls[key] || ["frames", "fps", "duration"].includes(key),
            ),
          );
          const modes =
            profile.imageModes &&
            Object.fromEntries(
              Object.entries(profile.imageModes).map(([mode, settings]) => {
                // The same merge Generate validates against when references select this mode.
                const merged = { ...profile, ...settings };
                return [
                  mode,
                  {
                    controls: listedControls(merged),
                    ...(settings?.prompting
                      ? {
                          prompting: full_guide
                            ? settings.prompting
                            : compactGuide(settings.prompting, maxShownGuideCharacters),
                        }
                      : {}),
                  },
                ];
              }),
            );
          const { loras, total } = mcpLoras(profile, infos, { ratings });
          const guide = full_guide
            ? profile.prompting
            : compactGuide(profile.prompting, maxShownGuideCharacters);
          const detail = {
            ...Object.fromEntries(
              [
                "id",
                "label",
                "kind",
                "family",
                "description",
                "mediaInputs",
                "aspectPolicy",
                "aspectPresets",
                "native",
              ]
                .filter((key) => key in profile)
                .map((key) => [key, profile[key]]),
            ),
            tier: tierOf(profile),
            references: referenceCount(profile),
            ...(workerState[profile.availability]
              ? { state: workerState[profile.availability] }
              : {}),
            // A combined profile: the backend it runs on (an old per-backend id names its own) and the others it has.
            ...(profile.backend
              ? {
                  backend: profile.namedBackend || profile.backend,
                  backends: profile.backendOptions.map((option) => option.label),
                }
              : {}),
            ...(tierNote ? { note: tierNote.trim() } : {}),
            defaults,
            controls,
            ...(modes
              ? {
                  imageModes: modes,
                  imageModes_note:
                    "A mode applies when its media is supplied, such as reference with references.",
                }
              : {}),
            ...(controls.loras
              ? {
                  loras: loras.slice(0, maxListedLoras),
                  loras_total: total,
                  loras_note: `Each reads name — hint [trigger word]${total > maxListedLoras ? `; the first ${maxListedLoras} shown, lora_query "all" with lora_page or other words finds others` : ""}. Pass names to Generate; strength defaults to the recommended value. Studio adds missing trigger words to every prompt.`,
                }
              : {}),
            ...(guide ? { prompting: guide } : {}),
          };
          return mcpJson(detail);
        },
        { readOnlyHint: true },
      );
      tool(
        server,
        "Generate",
        "Generate",
        `Queue images or videos. Pass your finished prompts (run as written) and the user's words as request. "4 sets of 2" is 4 distinct prompts with count 2; at most ${maxJobsPerCall} images per call. For several models in one call pass profile_ids, or each_profile with kind and tier ("each turbo model"). preview returns the prompts without queuing, for "suggest first". Put a model the user names in profile_id. Pass other controls only as Models lists them. upscale_quality only when the user asks to upscale or enlarge (it adds face detail for full-body people). Cloud profiles only if asked.`,
        {
          request: z
            .string()
            .trim()
            .min(1)
            .max(4000)
            .optional()
            .describe("The user's words, with anything they refer back to."),
          // Models sometimes send the list as one string; clients reject what the published schema doesn't allow.
          prompts: z
            .union([promptList, promptListText.pipe(promptList)])
            .optional()
            .describe("Run as written; count images each."),
          preview: z.boolean().optional(),
          count: jobCount.optional().describe("Images per prompt; default 1."),
          kind: z.enum(["image", "video"]).optional(),
          tier: tier.optional(),
          profile_id: z
            .string()
            .min(1)
            .optional()
            .describe("A model id, label or words from them; Models lists what is ready."),
          profile_ids: z.array(z.string().min(1)).min(1).max(maxJobsPerCall).optional(),
          each_profile: z.boolean().optional(),
          // Unknown keys (a misspelt "strength") are dropped rather than rejected.
          loras: z
            .array(z.object({ name: z.string().min(1), strength: z.number().finite().optional() }))
            .max(8)
            .optional()
            .describe("Each profile's limit is its controls.loras.max in Models."),
          reference_asset_ids: z
            .array(z.string().min(1))
            .max(16)
            .optional()
            .describe(
              "From Search uploads, Upload or Reuse mode reference; Models gives each profile's references.max.",
            ),
          reference_role: z.enum(["edit", "reference"]).optional(),
          aspect: z
            .string()
            .optional()
            .describe("landscape, portrait, square or a ratio like 16:9; prefer to width/height."),
          resolution: z.enum(["1K", "2K", "4K"]).optional(),
          width: z.number().int().positive().max(16384).optional(),
          height: z.number().int().positive().max(16384).optional(),
          steps: z.number().int().positive().max(10000).optional(),
          seed: z
            .number()
            .int()
            .nonnegative()
            .max(Number.MAX_SAFE_INTEGER - 4)
            .optional(),
          negative_prompt: z.string().optional(),
          cfg: z.number().finite().optional(),
          denoise: z.number().finite().optional(),
          sampler: z.string().optional(),
          scheduler: z.string().optional(),
          upscale_quality: z.enum(["fast", "balanced", "high"]).optional(),
          face_detail: z.boolean().optional(),
        },
        (input, signal) => {
          // A chat that sends the same Generate again within two minutes (a retry after a transport error, a doubled tool call) gets the first call's
          // jobs and reply, so one request is one set of images; asking again later, or for anything different, queues anew.
          const now = Date.now();
          for (const [key, entry] of recentGenerates)
            if (now - entry.at > generateDedupeMs) recentGenerates.delete(key);
          const key = `${refs || owner}\n${stableJson(input)}`;
          const earlier = generateDedupeMs > 0 ? recentGenerates.get(key) : null;
          if (earlier) return earlier.reply;
          const reply = generateOnce(input, signal);
          recentGenerates.set(key, { at: now, reply });
          reply.catch(() => {
            if (recentGenerates.get(key)?.reply === reply) recentGenerates.delete(key);
          });
          return reply;
        },
      );
      const generateOnce = async (input, signal) => {
        const {
          kind,
          tier: wanted,
          aspect,
          request,
          preview,
          profile_ids,
          each_profile,
          ...args
        } = structuredClone(input);
        if (!args.prompts)
          throw new Error(
            "Write the finished prompts yourself, following the model's prompting guide, and pass them as prompts (with the user's words as request), then call Generate again.",
          );
        if ([args.profile_id, profile_ids, each_profile].filter(Boolean).length > 1)
          throw new Error(
            "Pass one of profile_id (one model), profile_ids (several) or each_profile (every model of kind and tier), then call Generate again.",
          );
        const several = Boolean(profile_ids || each_profile);
        if (several && args.loras?.length)
          throw new Error(
            "LoRAs belong to one model: pass them with profile_id, or leave loras out for several models.",
          );
        // Instructions sent as an exact prompt would run literally, and their number of images would be lost.
        for (const prompt of args.prompts) {
          const instructed = exactPromptInstructions(prompt);
          if (instructed) throw new Error(instructed);
        }
        // "count: 4" beside four prompts means one image each, not sixteen.
        if (
          args.count > 1 &&
          args.count === args.prompts?.length &&
          args.count * args.prompts.length > maxJobsPerCall
        )
          args.count = 1;
        const count = args.count ?? 1;
        // Checked before any prompt is written, so an oversized call costs nothing and says how to split.
        assertJobCount(args.prompts?.length || 1, count);
        const references = args.reference_asset_ids?.length || 0;
        // Cloud (Grok) profiles only when the user asks for Grok or the cloud.
        const cloud = asksForCloud(request);
        let targets;
        if (profile_ids) {
          const profiles = await media.profiles(kind || "all", owner);
          targets = profile_ids.map((value) => namedInTier(profiles, value, wanted));
        } else if (each_profile) {
          const local = localUnlessAsked(await media.profiles(kind || "image", owner), { request });
          targets = (wanted ? profilesForTier(local, wanted) : local)
            .filter(
              ({ mediaInputs = [] }) =>
                mediaInputs.length >= references &&
                mediaInputs.filter((slot) => slot.required).length <= references,
            )
            .map((profile) => ({ profile, note: "" }));
          if (!targets.length)
            throw new Error(
              `No ready ${kind || "image"} profile${wanted ? ` in tier ${wanted}` : ""}. Call Models to see what is ready.`,
            );
        } else {
          // A model the request names ("fast moss") counts as its profile_id when the chat left it out.
          const fromRequest =
            args.profile_id === undefined && request && !args.loras?.length
              ? profileFromRequest(
                  localUnlessAsked(await media.profiles(kind || "image", owner), { request }),
                  request,
                  wanted,
                )
              : null;
          const fits = fromRequest && (fromRequest.profile.mediaInputs || []).length >= references;
          targets = [
            args.profile_id === undefined
              ? fits
                ? fromRequest
                : picked(
                    await media.choices(owner, {
                      kind,
                      tier: wanted,
                      references,
                      loras: args.loras || [],
                      cloud,
                    }),
                  )
              : namedInTier(await media.profiles(kind || "all", owner), args.profile_id, wanted),
          ];
        }
        targets = targets.filter(
          (target, index) =>
            targets.findIndex((other) => other.profile.id === target.profile.id) === index,
        );
        const jobs = targets.length * (args.prompts?.length || 1) * count;
        if (jobs > maxJobsPerCall)
          throw new Error(
            `${targets.length} models × ${jobs / targets.length} images each would queue ${jobs}; one call queues at most ${maxJobsPerCall}. Lower count, pass fewer profile_ids, or name a tier.`,
          );
        // A preview's prompts run as shown when the same call follows without preview.
        const previewKey = `${refs || owner}\n${stableJson({ ...input, preview: undefined })}`;
        const previewed = previews.get(previewKey);
        if (!preview) previews.delete(previewKey);
        const plans =
          !preview && previewed && Date.now() - previewed.at < previewMs
            ? previewed.plans
            : await Promise.all(
                targets.map(async ({ profile, note }) => {
                  const sized = mcpSize(profile, { aspect });
                  if (sized && (args.width !== undefined || args.height !== undefined))
                    throw new Error("Pass aspect or width and height, not both.");
                  const plan = {
                    ...args,
                    ...sized,
                    profile_id: profile.id,
                    ...(profile.namedBackend ? { profile_backend: profile.namedBackend } : {}),
                  };
                  return { profile, note, plan, source: "exact" };
                }),
              );
        if (preview) {
          if (previews.size >= 256) previews.delete(previews.keys().next().value);
          previews.set(previewKey, { at: Date.now(), plans });
          const lines = plans.map(
            ({ profile, plan }) =>
              `${profile.label || profile.id}: ${[...new Set(plan.prompts)].map(shortPrompt).join(" | ")}`,
          );
          return {
            content: [
              {
                type: "text",
                text: `Preview only; nothing is queued. Show the user these prompts and wait. To queue exactly these prompts, call Generate again with the same arguments without preview; for changes, call it with revised prompts.\n\n${lines.join("\n")}`,
              },
            ],
          };
        }
        // Request and prompts together: the prompts run, and the request stays on the record.
        const recordOf = ({ plan }) => {
          const assistant = actor.assistant
            ? chatAssistant.record(owner, plan.prompts || [], plan.loras || [])
            : null;
          return {
            ...(request ? { request } : {}),
            ...(assistant ? { assistant } : {}),
          };
        };
        if (several) {
          // One set per model, queued in order so each model loads once; links come back at once.
          // Every set shares one seed, so image N of each model is a like-for-like comparison.
          const seed = args.seed ?? crypto.randomInt(2 ** 31);
          const sets = [];
          for (const item of plans)
            sets.push({
              profile: item.profile,
              note: item.note,
              queued: (
                await submit(item.profile, { ...item.plan, seed }, recordOf(item), {
                  guide: false,
                })
              ).queued,
            });
          return respondSets(sets, "", signal, await comparisonOf(sets));
        }
        const [{ profile, note: tierNote, plan, source }] = plans;
        // A face is small in a full-body or wide shot of a person, so the final prompt turns face detail on unless the caller chose.
        // Face detail runs within smart upscale, so it joins only an upscale the caller asked for and never adds one.
        let faceNote = "";
        if (
          plan.face_detail === undefined &&
          plan.upscale_quality &&
          !references &&
          mcpControls(profile).face_detail &&
          plan.prompts.some(fullBodyPerson)
        ) {
          faceNote = "Face detail on for the full-body person. ";
          plan.face_detail = true;
        }
        const submission = await submit(profile, plan, recordOf({ plan }));
        return respond(
          submission.queued,
          profile,
          signal,
          submission.guide,
          source,
          `${tierNote || ""}${faceNote}`,
        );
      };
      tool(
        server,
        "Status",
        "Check Status",
        "A job\u2019s status and finished output links, only when the user asks.",
        { ...job, wait_seconds: wait },
        async ({ job_id, wait_seconds }, signal) => {
          const id = resolve(job_id);
          const status = await media.job(owner, id, wait_seconds, { signal });
          const ref = media.refOf(owner, refs, id);
          return mcpJson({
            job_id: id,
            ...(ref ? { ref } : {}),
            link: media.pageUrl(owner, id),
            ...media.summary(status),
            outputs: (status.outputs || []).flatMap((item, index) =>
              mcpOutputPath(item.url)
                ? [{ output_index: index, url: media.url(owner, id, index) }]
                : [],
            ),
          });
        },
        { readOnlyHint: true },
      );
      tool(
        server,
        "Result",
        "Show Result",
        'Show results as markdown to reply with, only when the user asks ("show result 3"; job_id "all" for all). A running job returns its link: share it and stop; never poll, repeat or background this.',
        {
          job_id: z.string().min(1).max(200),
          wait_seconds: wait,
        },
        ({ job_id, wait_seconds }, signal) =>
          /^\s*all\s*$/i.test(job_id)
            ? media.resultsAll(owner, refs, { signal })
            : media.result(owner, resolve(job_id), wait_seconds, { scope: refs, signal }),
        { readOnlyHint: true },
      );
      tool(
        server,
        "Search",
        "Search Gallery",
        "Find the user's earlier work by its words or look, with refs for Reuse, Review and Result. uploads: the user's uploads, as reference_asset_ids.",
        {
          query: z.string().trim().max(200).default(""),
          kind: z.enum(["image", "video"]).optional(),
          starred: z.boolean().default(false),
          uploads: z.boolean().default(false),
          limit: z.number().int().min(1).max(24).default(8),
        },
        async (args, signal) => {
          const hits = await media.search(owner, refs, args, { signal });
          if (!hits.length)
            return {
              content: [{ type: "text", text: "Nothing in the gallery matches." }],
              structuredContent: { results: [] },
            };
          if (args.uploads) {
            const results = hits.map((item) => ({
              reference_asset_id: item.assetId,
              name: item.filename || "",
              created_at: item.createdAt || "",
            }));
            const lines = hits.map((item) =>
              [
                `- ${item.assetId}`,
                item.filename,
                String(item.createdAt || "").slice(0, 10),
                (item.caption?.text || item.suggestedPrompt) &&
                  shortPrompt(item.caption?.text || item.suggestedPrompt),
              ]
                .filter(Boolean)
                .join(" · "),
            );
            return {
              content: [
                {
                  type: "text",
                  text: `${hits.length === 1 ? "One upload" : `${hits.length} uploads`}, newest first. Pass one to Generate in reference_asset_ids.\n\n${lines.join("\n")}`,
                },
              ],
              structuredContent: { results },
            };
          }
          const results = hits.map((item) => ({
            ref: media.refOf(owner, refs, item.jobId),
            job_id: item.jobId,
            output_index: item.index,
            link: media.url(owner, item.jobId, item.index),
          }));
          const lines = hits.map((item, position) => {
            const { ref, output_index, link } = results[position];
            return [
              `- [${ref[0].toUpperCase()}${ref.slice(1)}${output_index ? ` output ${output_index}` : ""}](${link})`,
              item.title && shortPrompt(item.title),
              item.settings?.modelName || item.model || item.settings?.profileId,
              String(item.createdAt || "").slice(0, 10),
              item.prompt && shortPrompt(item.prompt),
            ]
              .filter(Boolean)
              .join(" · ");
          });
          // The images as one picture, in the order listed; it is drawn only when opened.
          const images = hits.filter((item) => item.type === "image");
          const picture = !images.length
            ? ""
            : `\n\n![Matching images in order](${
                images.length === 1
                  ? media.previewUrl(owner, images[0].jobId, images[0].index)
                  : media.sheetUrl(
                      owner,
                      images.map((item) => [item.jobId, item.index]),
                    )
              })`;
          return {
            content: [
              {
                type: "text",
                text: `${hits.length === 1 ? "One match" : `${hits.length} matches`}, newest first. Pass a ref (and output_index for a later output) to Reuse, Review or Result.\n\n${lines.join("\n")}${picture}`,
              },
            ],
            structuredContent: { results },
          };
        },
        { readOnlyHint: true },
      );
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
      tool(
        server,
        "Handover",
        "Copy Chat Summary",
        "A copy-paste summary for a new chat, when asked or when the host reports about 90% context used. Pass decisions, preferences and unfinished work as summary.",
        {
          summary: z.string().trim().min(1).max(12000),
        },
        async ({ summary }, signal) => {
          const jobs = (await media.scopeJobs(owner, refs, { signal }))
            .filter(
              ({ job }) =>
                !["done", "completed", "succeeded"].includes(job.status) ||
                job.outputs?.some((output) => mcpOutputPath(output.url)),
            )
            .slice(-12);
          const results = jobs.map(
            ({ jobId, number, job }) =>
              `- Result ${number}: job_id ${jobId} (${job.status}) — ${media.pageUrl(owner, jobId)}`,
          );
          const handover = [
            "Continue this Studio task.",
            "",
            summary,
            "",
            "Studio Results",
            ...results,
            "",
            "Use the job_id values above in the new chat; result numbers are local to the old chat. Do not regenerate or poll unless asked.",
          ].join("\n");
          return { content: [{ type: "text", text: handover }] };
        },
        { readOnlyHint: true },
      );
      tool(
        server,
        "Review",
        "Review Image",
        "Inspect an image only when asked to judge, compare or improve it: a small preview with prompt and settings; compare_to sets another result beside it.",
        {
          ...output,
          compare_to: z.string().min(1).max(200).optional(),
        },
        ({ job_id, output_index, compare_to }, signal) =>
          media.review(
            owner,
            [
              { jobId: resolve(job_id), index: output_index },
              ...(compare_to ? [{ jobId: resolve(compare_to), index: 0 }] : []),
            ],
            { scope: refs, signal },
          ),
        { readOnlyHint: true },
      );
      tool(
        server,
        "Cancel",
        "Cancel",
        "Cancel a job when the user asks.",
        job,
        async ({ job_id }) => {
          const id = resolve(job_id);
          media.own(owner, id);
          await media.job(owner, id);
          return mcpJson(
            await media.request("POST", `/api/jobs/${encodeURIComponent(id)}/cancel`, {}, owner),
          );
        },
        { destructiveHint: true },
      );
      // Studio Chat attaches its references itself; a model cannot send an image's bytes.
      if (!actor.session) {
        tool(
          server,
          "Upload",
          "Upload Reference",
          `Upload a PNG, JPEG or WebP reference image (base64, at most ${maxUploadMegabytes} MB) for Generate.`,
          {
            // Left unbounded below so an empty file gets Upload's own advice, not a schema refusal.
            content_base64: z.string().max(maxUploadBase64),
            filename: z.string().default("reference.png"),
          },
          async ({ content_base64, filename }) =>
            mcpJson(await media.upload(owner, content_base64, filename)),
        );
        tool(
          server,
          "UploadLink",
          "Upload Link",
          "A one-time page where the user uploads an image attached in chat.",
          {},
          async () => {
            const { url, expires } = media.uploadUrl(owner);
            return {
              content: [
                {
                  type: "text",
                  text: `Ask the user to open this link and upload the photo they attached, then call Search with uploads to use it as a reference. It works once, for ${uploadLinkMinutes} minutes.\n\n[Upload Photo](${url})`,
                },
              ],
              structuredContent: { link: url, expires_at: new Date(expires).toISOString() },
            };
          },
        );
      }
      tool(
        server,
        "Reuse",
        "Reuse Result",
        `Follow up on one finished result. mode again (default) reruns it with a new seed: prompt is your revised prompt, run as written; preserve_seed keeps its seed. mode animate makes an image a video, extend continues a video from its last frame; prompt is the motion, or pass theme; length is seconds. tier or profile_id picks the model. mode reference returns it as a reference_asset_id for Generate. mode upscale enlarges it in place, only when asked (upscale_quality, balanced by default).`,
        {
          ...output,
          job_id: z
            .string()
            .min(1)
            .max(200)
            .describe('Its ref as the reply shows it ("result 1"), or a job_id; never "all".'),
          mode: z.enum(["again", "animate", "extend", "reference", "upscale"]).default("again"),
          request: z.string().trim().min(1).max(2000).optional(),
          prompt: z.string().trim().min(1).optional(),
          tier: tier.optional(),
          profile_id: z.string().min(1).optional(),
          preserve_seed: z.boolean().default(false),
          count: jobCount.default(1),
          theme: theme.optional(),
          length: z.number().optional(),
          upscale_quality: z.enum(["fast", "balanced", "high"]).optional(),
        },
        async (
          {
            job_id,
            output_index,
            mode,
            upscale_quality,
            tier: wanted,
            profile_id,
            preserve_seed,
            request,
            prompt,
            count,
            theme,
            length,
          },
          signal,
        ) => {
          const id = resolve(job_id);
          const animating = mode === "animate" || mode === "extend";
          if (theme && (!animating || prompt))
            throw new Error(
              "theme is for mode animate or extend without prompt. Call Reuse again.",
            );
          if (length && !animating)
            throw new Error("length is for mode animate or extend. Call Reuse again.");
          if (theme === "custom" && !request)
            throw new Error("theme custom needs request: what should happen. Call Reuse again.");
          if (upscale_quality && mode !== "upscale")
            throw new Error("upscale_quality is for mode upscale. Call Reuse again.");
          if (mode === "upscale") {
            if (wanted || prompt || request || profile_id || preserve_seed || theme || count > 1)
              throw new Error(
                "mode upscale takes only job_id, output_index and upscale_quality. Call Reuse again.",
              );
            media.own(owner, id);
            const { items = [] } = await media.request(
              "GET",
              `/api/gallery/jobs/${encodeURIComponent(id)}`,
              undefined,
              owner,
              { signal },
            );
            const item = items.find(
              (entry) => (entry.index ?? 0) === output_index && entry.status === "done",
            );
            if (!item?.id) throw new Error("This result has no finished output to upscale.");
            const quality = upscale_quality || "balanced";
            const { plan } = await media.request(
              "POST",
              "/api/upscale",
              { galleryItemId: item.id, quality },
              owner,
              { signal },
            );
            return mcpJson({
              upscaling: true,
              quality,
              ...(plan?.estimatedWidth
                ? { size: `${plan.estimatedWidth}×${plan.estimatedHeight}` }
                : {}),
              link: media.pageUrl(owner, id),
              note: "Queued. The upscale shows on this result in the gallery when it finishes; share the link and end your turn.",
            });
          }
          if (mode === "reference") {
            if (wanted || prompt || request || profile_id || preserve_seed || count > 1)
              throw new Error(
                "mode reference takes only job_id and output_index. To generate from this result, call Reuse with mode again or animate.",
              );
            const result = await media.download(owner, id, output_index);
            if (!imageMimes.includes(result.mime))
              throw new Error("Only images can be reused as references.");
            return mcpJson(
              await media.upload(
                owner,
                result.content.toString("base64"),
                `reference.${result.mime.split("/")[1]}`,
              ),
            );
          }
          // Studio never rewrites a prompt: the chat writes the change into it; request is the user's words.
          if (request && !prompt && !theme)
            throw new Error(
              "Studio runs prompts exactly as given. Write the revised prompt yourself from the result's prompt and pass it as prompt (for animate, the motion), with the user's words as request, or leave request out to run the prompt unchanged. Call Reuse again.",
            );
          const item = await media.source(owner, id, output_index);
          if (mode === "extend" && item.type !== "video")
            throw new Error(
              "mode extend continues a video; to make an image a video, use mode animate.",
            );
          const own = item.type === "video" ? "video" : "image";
          const kind = animating ? "video" : own;
          if (preserve_seed && (animating || wanted || profile_id))
            throw new Error(
              "preserve_seed is for a same-model revision, not animation or a model/tier change. Call Reuse again without preserve_seed.",
            );
          let plan;
          // Animating may name the video model ("grok imagine") in profile_id; naming a cloud profile asks for the cloud.
          const named =
            animating && profile_id
              ? namedInTier(await media.profiles("video", owner), profile_id, wanted)
              : null;
          const cloud =
            asksForCloud(request) ||
            asksForCloud(prompt) ||
            Boolean(named && isCloudProfile(named.profile));
          if (animating)
            plan = await media.animate(owner, id, output_index, item, {
              tier: wanted,
              count,
              cloud,
              length,
              profile: named?.profile,
              note: named?.note,
            });
          else if (wanted || profile_id) {
            const references = (item.settings?.referenceAssets || []).filter(
              (asset) => asset?.assetId,
            ).length;
            const target = profile_id
              ? namedInTier(await media.profiles(kind, owner), profile_id, wanted)
              : await media.choose(owner, { kind, tier: wanted, references, cloud });
            plan = { ...media.retarget(item, target.profile, { count }), tierNote: target.note };
          } else plan = await media.rerun(owner, item, { count });
          const recorded = media.promptRecord(id);
          const moved = animating || Boolean(wanted || profile_id);
          if (preserve_seed) {
            const seed = String(item.settings?.seed ?? "");
            if (!/^\d+$/.test(seed))
              throw new Error("This result has no recorded numeric seed to preserve.");
            const numeric = Number(seed);
            if (!Number.isSafeInteger(numeric) || !Number.isSafeInteger(numeric + count - 1))
              throw new Error(
                "The recorded seed is outside the exact numeric range for a controlled revision.",
              );
            plan.args.seed = numeric;
          }
          let source = "exact";
          if (prompt) plan.args.prompts = [prompt];
          else if (theme) {
            // The viewer's Animate themes: the queue item writes the motion prompt (prompt-animate.js).
            const write = {
              animate: {
                theme,
                instruction: request || "",
                source: item.prompt,
                ...(item.type === "video" ? { extend: true } : {}),
              },
            };
            Object.assign(plan.args, { prompts: [""], write });
            source = "studio";
          }
          // A plain run again keeps the result's prompt, so it keeps how that prompt was written (Recreate does the same).
          const carried = !prompt && !moved ? item.assistant || recorded?.assistant : null;
          const submission = await submit(plan.profile, plan.args, {
            ...((request || !prompt) && (request || recorded?.request)
              ? { request: request || recorded.request }
              : {}),
            ...(carried ? { assistant: carried } : {}),
            parent: id,
          });
          const dropped = plan.droppedLoras?.length
            ? `Left out ${plan.droppedLoras.length === 1 ? "a LoRA" : `${plan.droppedLoras.length} LoRAs`} made for another model (${plan.droppedLoras.join(", ")}); tell the user. `
            : "";
          return respond(
            submission.queued,
            plan.profile,
            signal,
            submission.guide,
            source,
            `${plan.tierNote || ""}${dropped}`,
          );
        },
      );
    } else {
      const workloadList = z.array(z.string().min(1)).max(32);
      /** A preset placement; workloads in other GPU pools keep running as they are. */
      const modePlacement = async (mode, textProfile) => {
        const configured = runtime.workloads;
        const pick = (kind, gpus) => {
          const found = configured.find((item) => item.kind === kind && item.gpus === gpus);
          if (!found) throw new Error(`No ${gpus}-GPU ${kind} workload is configured.`);
          return found;
        };
        const status = await runtime.observe();
        const running = (item) => ["running", "starting"].includes(item.phase);
        const anchor = mode === "video" ? pick("video", 2) : pick("image", 1);
        const elsewhere = status.workloads
          .filter((item) => item.pool !== anchor.pool && running(item))
          .map((item) => item.id);
        if (mode === "video") return [anchor.id, ...elsewhere];
        if (mode === "image_video") return [anchor.id, pick("video", 1).id, ...elsewhere];
        const fits = configured
          .filter((item) => item.kind === "text" && item.gpus === 1 && item.pool === anchor.pool)
          .map((item) => item.id);
        const current = status.workloads.find(
          (item) => fits.includes(item.id) && running(item),
        )?.id;
        const text = textProfile || current || "";
        if (!fits.includes(text))
          throw new Error(`Name text_profile, a text model that fits one GPU: ${fits.join(", ")}.`);
        return [text, anchor.id, ...elsewhere];
      };
      tool(
        server,
        "GPUStatus",
        "GPU Status",
        "Read each GPU workload's state, the GPUs in use and the current or last runtime change.",
        {},
        async () => mcpJson(await runtime.observe()),
        { readOnlyHint: true },
      );
      tool(
        server,
        "Workloads",
        "List Workloads",
        "List the GPU workloads Studio can run, with their kind, GPU pool and GPU count.",
        {},
        () =>
          mcpJson({
            pools: runtime.pools,
            workloads: runtime.workloads.map(({ id, label, kind, pool, gpus }) => ({
              id,
              label,
              kind,
              pool,
              gpus,
            })),
          }),
        { readOnlyHint: true },
      );
      tool(
        server,
        "Preview",
        "Preview Placement",
        "Preview a COMPLETE placement without applying it: the listed workload ids run and every other stops; an empty list stops all. Present the changes for approval; discard to cancel.",
        { workloads: workloadList },
        async ({ workloads }) => mcpJson(await runtime.preview(workloads)),
        { readOnlyHint: true },
      );
      tool(
        server,
        "Apply",
        "Apply Placement",
        "Apply an explicitly requested placement only after its Preview was presented and approved, with its exact signature. Studio waits for accepted work on stopping workloads, then switches; poll Operation. Never use it for media generation.",
        {
          workloads: workloadList,
          signature: z.string().min(1),
          confirmed: z.boolean().default(false),
        },
        async ({ workloads, signature, confirmed }) => {
          if (!confirmed)
            throw new Error(
              "Present the preview and obtain approval before applying this placement.",
            );
          return mcpJson(await runtime.apply(workloads, signature, "control-mcp"));
        },
        { destructiveHint: true },
      );
      tool(
        server,
        "Mode",
        "Preview GPU Mode",
        "Preview a preset placement only when the user asks for it: image_text (a one-GPU text model and image), image_video (image and one-GPU video) or video (two-GPU video). image_text keeps the running text model when it fits one GPU; otherwise pass text_profile. Present the changes for approval, then Apply the returned workloads and signature.",
        {
          mode: z.enum(["image_text", "image_video", "video"]),
          text_profile: z.string().min(1).optional(),
        },
        async ({ mode, text_profile }) =>
          mcpJson(await runtime.preview(await modePlacement(mode, text_profile))),
        { readOnlyHint: true },
      );
      tool(
        server,
        "Restart",
        "Restart Workload",
        "Restart a running workload in place, only when the user asks: Studio waits for its accepted work, scales it to 0 and back to 1. workload is an id from GPUStatus. Never starts a stopped workload or changes the placement.",
        { workload: z.string().min(1) },
        async ({ workload }) => mcpJson(await runtime.restart(workload, "control-mcp")),
        { destructiveHint: true },
      );
      tool(
        server,
        "Operation",
        "Check Operation",
        "Read the runtime change returned by Apply or Restart, without waiting.",
        { job_id: z.string().regex(/^[a-zA-Z0-9]{1,64}$/) },
        ({ job_id }) => mcpJson(runtime.operation(job_id)),
        { readOnlyHint: true },
      );
    }
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
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.once("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
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
  // Export's signed bundle links (mcp-admin.js): the file Library › Profiles › Download All wrote, for an hour.
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
  // UploadLink's page, under /mcp/results so the public result route reaches it: the link is the
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
        accountMode ? internalCredential(claims.owner) : undefined,
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
        // Account mode reads as the signed owner through MCP's loopback credential; the studio rechecks that account's access.
        const credential = accountMode ? internalCredential(claims.owner) : undefined;
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
    if (account) media.credentials.set(owner, internalCredential(owner));
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
