// SPDX-License-Identifier: AGPL-3.0-only
// Native port of the Studio MCP service; see mcp.LICENSE.
import crypto from "node:crypto";
import path from "node:path";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { hostAllowed } from "./request-guard.js";
import {
  closest,
  listedControls,
  mcpControls,
  mcpGenerationCount,
  mcpLoras,
  mcpSize,
} from "./mcp-controls.js";
import {
  McpMedia,
  assertJobCount,
  maxJobsPerCall,
  mcpJson,
  mcpOutputPath,
  replyRule,
} from "./mcp-media.js";
import { exactPromptInstructions, fullBodyPerson } from "./mcp-prompt-checks.js";
import { livePrompting } from "./profile-store.js";
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
  speedWordList,
  profilesForTier,
  profilesNearTier,
  searchProfiles,
  tierOf,
  withinFamily,
} from "./mcp-tiers.js";
import { createPromptWriter } from "./prompt-writer.js";
import { createControlClient } from "./ai-control.js";
import { gatewaySettings } from "./assistant.js";
import { mayUseFeature } from "./account-policy.js";
import { createChatAssistantMemory, registerAssistantTools } from "./mcp-assistant.js";
import { adminInstructions, registerAdminTools } from "./mcp-admin.js";
import fs from "node:fs";

// Generate waits up to this long, and only when Studio's estimate says the set finishes within it; otherwise its links return at once.
export const generateWaitSeconds = 30;
// How long Generate reads the first job for its end time while the queue picks it up.
const etaProbeMilliseconds = 2000;
// An identical Generate from the same conversation within this window is the same request (see Generate).
export const generateDedupeWindowMs = 120_000;
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
const mediaInstructions = (writing) =>
  `Studio makes images and videos. Pass the user's words to Generate as request${
    writing
      ? ": Studio picks the model and writes each prompt with that model's prompting guide, so don't fetch guides, expand the request or deliberate over wording or models"
      : ", as one clear prompt that keeps their subjects and scene"
  }. Use prompts only for prompts the user gave; count is images per prompt. Make one Generate call per set, one after another; for several models at once pass profile_ids, or each_profile with tier ("each turbo model"). To suggest first, call Generate with preview and wait for the user. Set kind, and tier only when asked (${tierWords}). "landscape" or "16:9" is aspect; "2K" is size; upscale only when the user asks to upscale or enlarge. Ordinary requests need no Models call. For a follow-up on a result ("again", "warmer", "with Krea", "animate it"), call Reuse with its ref and the change as request, not a new Generate. Reply briefly as each result says; if queued, share the links and end the turn. Call Result only when the user asks to see results, never in the background. Never poll, resubmit or invent results. If a named model is unavailable, say so; don't substitute. Call Review only when asked to judge, compare or improve images. When the host reports about 90% context used, call Handover.`;
const controlInstructions =
  "GPU allocation is manual: use these tools only on explicit request, and present a Preview or Mode preview and get approval before Apply. Restart only what the user names. Media generation never changes allocation.";
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
const tier = z.enum(mcpTiers).describe("turbo is Super Fast.");
const jobCount = z.number().int().min(1).max(maxJobsPerCall);
// A prompting guide and a LoRA library are long; chat gets their essentials (lora_query finds the rest).
const maxGuideCharacters = 1200;
// Models shows a guide's gist; Generate's prompt writer applies the whole guide.
const maxShownGuideCharacters = 500;
const maxListedLoras = 30;
/** A profile guide's essentials as one capped paragraph: summary, rules and pitfalls, without sources or examples. */
export function compactGuide(guide, max = maxGuideCharacters) {
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
const allocation = z
  .array(
    z.object({ profile: z.string().min(1), devices: z.array(z.string().min(1)).min(1) }).strict(),
  )
  .max(32);

/** Optional authenticated MCP on the studio's existing HTTP(S) server. */
export function registerMcpRoutes(
  app,
  {
    dataDir,
    baseUrl,
    environment = process.env,
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
    gatewayAdminTools = () => false,
    claimHandover = () => false,
    // The owner's taste profile summary, or "", as context for the auto model pick.
    taste = () => "",
  } = {},
) {
  const mediaKey = environment.STUDIO_MCP_API_KEY;
  const controlKey = environment.CONTROL_MCP_API_KEY;
  if (!mediaKey && !controlKey && !accountMode) return null;
  if (
    controlKey &&
    (!environment.CONTROL_URL ||
      !environment.CONTROL_API_KEY ||
      equal(controlKey, mediaKey) ||
      equal(controlKey, environment.CONTROL_API_KEY) ||
      equal(mediaKey, environment.CONTROL_API_KEY))
  )
    throw new Error("AI Control requires separate MCP/media/upstream credentials and CONTROL_URL.");
  const publicUrl =
    environment.MCP_PUBLIC_URL?.replace(/\/+$/, "") ||
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
      "MCP_PUBLIC_URL must be an absolute HTTP(S) base URL without credentials, query or fragment.",
    );
  const media =
    mediaKey || accountMode
      ? new McpMedia({
          dataDir,
          baseUrl,
          publicUrl: environment.MCP_PUBLIC_URL
            ? publicUrl
            : () => (typeof baseUrl === "function" ? baseUrl() : baseUrl),
          signingKey: environment.MCP_SIGNING_KEY,
          fetchImpl,
          resolveSignedResult,
          domainRequest,
        })
      : null;
  // Studio's guide store (guides/prompting.json) first, the deployment's MCP_PROMPTING_PATH as seed, reloaded on change.
  const prompting = livePrompting({ dataDir, seedFile: environment.MCP_PROMPTING_PATH });
  // Optional: with a writer, Studio writes each prompt from the request; a partial setting fails at start.
  const writer = createPromptWriter(environment, { fetchImpl });
  const instructions = mediaInstructions(Boolean(writer));
  // The prompt assistant's tools need its LiteLLM gateway; what the chat wrote is remembered for the results' records.
  const assistantGateway = Boolean(gatewaySettings(environment));
  const chatAssistant = createChatAssistantMemory({
    file: dataDir ? path.join(dataDir, "mcp-assistant.json") : "",
  });
  // The studio's rescan or any model change refreshes MCP's per-owner catalogue cache.
  if (media)
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
  const inflightKey = (actor, requestId) =>
    JSON.stringify([actor.scope, actor.owner, String(requestId)]);
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
    // Prompt Assistant is an access-profile feature; the shared key without accounts (single user) has it.
    const assistant =
      scope === "media" &&
      assistantGateway &&
      (!account || mayUseFeature(account, "promptAssistant"));
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
          annotations: { readOnlyHint: false, destructiveHint: false, ...annotations },
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
    // A job handed over to the chat (chat-handover.js) becomes this account's for the chat (chat-handover.js).
    const resolve = (value) => {
      const id = media.resolve(owner, refs, value);
      if (
        typeof id === "string" &&
        !media.owns(owner, id) &&
        claimHandover(owner, id, { accountMode })
      )
        media.adopt(owner, id);
      return id;
    };
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
      const followUp = `To change or animate one later, call Reuse with its ref (such as "${submission.jobs[0]?.ref || "result 1"}") and the change as request.`;
      // A set Studio expects to finish within the wait comes back finished, so the agent needs no Result call;
      // anything longer, or with no trusted estimate, hands back its links at once.
      const [endsAt] = await media.finishTimes(owner, [submission], {
        probeMs: etaProbeMs,
        signal,
      });
      const expected = endsAt === null ? null : Math.max(0, endsAt - Date.now());
      const seconds =
        expected !== null && expected <= imageWaitSeconds * 1000 ? imageWaitSeconds : 0;
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
            text: `Queued ${sets.length} sets, one per model. ${note}Share the links below, not images (none exist yet), and end your turn; do not call Result now or in the background. Never poll or resubmit. To change or animate one later, call Reuse with its ref (such as "${first}") and the change as request.${compare ? " Share the comparison link first: it shows every model side by side with the same seed." : ""}\n\n${compare ? `[Compare Side by Side](${compare})\n` : ""}${lines.join("\n")}\n[All Results](${media.allUrl(owner, refs)})`,
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
    /**
     * Without a named model, the writer picks from Studio's choices by the request; otherwise the usual
     * pick stands. With several to choose from, the note says which and why, in one line.
     */
    const picked = async ({ pool, profile, note: fallback }, request, signal) => {
      if (pool.length < 2) return { profile, note: fallback };
      const choice =
        writer && request
          ? await writer.pick({
              request,
              profiles: pool,
              preferred: profile,
              taste: taste(owner),
              signal,
            })
          : null;
      const chosen = choice?.profile || profile;
      return {
        profile: chosen,
        note: `${fallback}Chose ${chosen.label || chosen.id}${choice ? `: ${choice.reason}` : ", the default"}. `,
      };
    };
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
    /** Profiles as Models lists them: "id — label" grouped by kind. */
    const listed = (profiles) => {
      const list = {};
      for (const profile of profiles)
        (list[profile.kind] ||= []).push(
          profile.label && profile.label !== profile.id
            ? `${profile.id} — ${profile.label}`
            : profile.id,
        );
      return list;
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
     * Queues a submission with the request behind it. Without a prompt writer, the profile's guide goes to a
     * conversation that has not had it, marked before any wait; with one, the chat never needs it.
     */
    const submit = async (profile, args, record = {}, { guide = true } = {}) => {
      const fresh = guide && !writer && review(refs, profile.id);
      try {
        const queued = await media.queue(owner, args, refs, {
          ...record,
          ...(conversation ? { conversation } : {}),
        });
        return { queued, guide: fresh ? compactGuide(prompting(profile, true)) : "" };
      } catch (error) {
        // A refused submission delivered no guide, so the next attempt carries it.
        if (fresh) reviewedGuides.delete(guideKey(refs, profile.id));
        throw error;
      }
    };
    /** Prompts for a target profile: written from the request and its changes, or the fallback when writing is off or fails. */
    const write = async (
      profile,
      {
        request,
        changes = [],
        count,
        references = 0,
        role = "",
        suggest = false,
        fallback,
        signal,
      },
    ) => {
      if (!writer) return { prompts: fallback, source: "request" };
      const guided =
        references && profile.imageModes?.reference
          ? { ...profile, ...profile.imageModes.reference }
          : profile;
      return writer.write({
        profile,
        guide: prompting(guided, true),
        request,
        changes,
        count,
        references,
        role,
        suggest,
        fallback,
        signal,
      });
    };
    /** Sets a plan's prompts from what was written: one each, or the fallback with the requested count. */
    const usePrompts = (args, written, count) => {
      if (written.source === "studio") Object.assign(args, { prompts: written.prompts, count: 1 });
      else Object.assign(args, { prompts: written.prompts, count });
      return written.source;
    };
    const server = new McpServer(
      { name: "Studio", version: "1.0.0" },
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
        'List ready profiles as "id — label" by kind. With profile_id (id, label or words: "flux 3"): the gist of its guide, defaults, controls, reference slots and LoRAs; lora_query or lora_names detail up to five LoRAs. Rarely needed: Generate picks models and resolves names.',
        {
          kind: z.enum(["all", "image", "video"]).default("all"),
          tier: tier.optional(),
          profile_id: z.string().optional(),
          lora_query: z
            .string()
            .max(200)
            .optional()
            .describe("Looks up LoRAs by name, title or trigger."),
          lora_names: z.array(z.string().min(1)).max(5).optional(),
          full_guide: z
            .boolean()
            .optional()
            .describe("The whole prompting guide; rarely needed, as Studio applies it."),
        },
        async ({ kind, tier: wanted, profile_id, lora_query, lora_names = [], full_guide }) => {
          let profiles = await media.profiles(kind, owner);
          if (profile_id === undefined) {
            // Cloud (Grok) profiles list apart: Generate uses one only when the user asks for Grok or the cloud.
            const cloud = profiles.filter(isCloudProfile);
            profiles = profiles.filter((profile) => !isCloudProfile(profile));
            if (wanted) profiles = profilesNearTier(profiles, wanted);
            return mcpJson({
              ...listed(profiles),
              ...(cloud.length
                ? {
                    cloud: listed(cloud),
                    cloud_note: "Only when the user asks for Grok or the cloud.",
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
          const controls = listedControls(profile);
          // A LoRA lookup answers only that question; the profile's guide and controls come without one.
          if (controls.loras && (lora_query || lora_names.length)) {
            const { loras, total, more, missing } = mcpLoras(profile, infos, {
              query: lora_query,
              names: lora_names,
            });
            return mcpJson({
              id: profile.id,
              loras,
              loras_total: total,
              ...(more ? { more_matches: more } : {}),
              ...(missing ? { missing } : {}),
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
          const { loras, total } = mcpLoras(profile, infos);
          const guide = full_guide
            ? prompting(profile, true)
            : compactGuide(prompting(profile, true), maxShownGuideCharacters);
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
                  loras_note: `Each reads name — hint [trigger word]${total > maxListedLoras ? `; the first ${maxListedLoras} shown, lora_query finds others` : ""}. Pass names to Generate; strength defaults to the recommended value. Studio adds missing trigger words to every prompt.`,
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
        `Queue images or videos. Pass the user's words as request: Studio picks the model${writer ? " and writes each prompt with that model's prompting guide, so never fetch guides or deliberate over wording" : ""}. prompts run as written, one image each${writer ? "; apply_guide rewrites them for each model's guide" : ""}. Several images ("six photos" is count 6) take one call; one call queues at most ${maxJobsPerCall} jobs. For several models in one call pass profile_ids, or each_profile with kind and tier ("each turbo model"). preview returns the prompts${writer ? " and concept suggestions" : ""} without queuing, for "suggest first". Put a model the user names (Krea, FLUX.3) in profile_id. Pass other controls only as Models lists them. upscale_quality only when the user asks to upscale or enlarge (it adds face detail for full-body people). Cloud profiles only if asked. To change, rerun or animate an earlier result, call Reuse instead.`,
        {
          request: z
            .string()
            .trim()
            .min(1)
            .max(4000)
            .optional()
            .describe("The user's words, with anything they refer back to."),
          prompts: z
            .array(z.string().trim().min(1))
            .min(1)
            .max(maxJobsPerCall)
            .optional()
            .describe("Run as written, one image each."),
          apply_guide: z.boolean().optional(),
          preview: z.boolean().optional(),
          count: jobCount.optional().describe("Images per prompt; default 1."),
          kind: z.enum(["image", "video"]).optional(),
          tier: tier.optional(),
          profile_id: z
            .string()
            .min(1)
            .optional()
            .describe('A model, family or id, e.g. "fast moss".'),
          profile_ids: z.array(z.string().min(1)).min(1).max(maxJobsPerCall).optional(),
          each_profile: z.boolean().optional(),
          loras: z
            .array(
              z
                .object({ name: z.string().min(1), strength: z.number().finite().optional() })
                .strict(),
            )
            .max(8)
            .optional()
            .describe("Up to 8; a profile may take fewer (Models)."),
          reference_asset_ids: z
            .array(z.string().min(1))
            .max(16)
            .optional()
            .describe("From Upload, or Reuse with mode reference."),
          reference_role: z.enum(["edit", "reference"]).optional(),
          aspect: z
            .string()
            .optional()
            .describe("landscape, portrait, square or a ratio like 16:9; prefer to width/height."),
          size: z.enum(["2k", "4k"]).optional(),
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
          size,
          request,
          apply_guide,
          preview,
          profile_ids,
          each_profile,
          ...args
        } = structuredClone(input);
        if (!request && !args.prompts)
          throw new Error(
            "Pass request with the user's words, or prompts to run as written, then call Generate again.",
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
        if (!apply_guide)
          for (const prompt of args.prompts || []) {
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
                : await picked(
                    await media.choices(owner, {
                      kind,
                      tier: wanted,
                      references,
                      loras: args.loras || [],
                      cloud,
                    }),
                    request,
                    signal,
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
            `${targets.length} models × ${jobs / targets.length} images each would queue ${jobs} jobs; one call queues at most ${maxJobsPerCall}. Lower count, pass fewer profile_ids, or name a tier.`,
          );
        // A preview's prompts run as shown when the same call follows without preview.
        const previewKey = `${refs || owner}\n${stableJson({ ...input, preview: undefined })}`;
        const previewed = previews.get(previewKey);
        if (!preview) previews.delete(previewKey);
        const role = references ? args.reference_role || "reference" : "";
        // Every model's prompts are written at once, each with its own guide.
        const plans =
          !preview && previewed && Date.now() - previewed.at < previewMs
            ? previewed.plans
            : await Promise.all(
                targets.map(async ({ profile, note }, index) => {
                  const sized = mcpSize(profile, { aspect, size });
                  if (sized && (args.width !== undefined || args.height !== undefined))
                    throw new Error("Pass aspect and size, or width and height, not both.");
                  const plan = { ...args, ...sized, profile_id: profile.id };
                  const suggest = Boolean(preview && index === 0);
                  let source = "exact";
                  let suggestions = [];
                  if (!args.prompts) {
                    const written = await write(profile, {
                      request,
                      count,
                      references,
                      role,
                      suggest,
                      fallback: [request],
                      signal,
                    });
                    suggestions = written.suggestions || [];
                    source = usePrompts(plan, written, count);
                  } else if (apply_guide) {
                    const written = await Promise.all(
                      args.prompts.map((prompt, position) =>
                        write(profile, {
                          request: prompt,
                          count,
                          references,
                          role,
                          suggest: suggest && position === 0,
                          fallback: [prompt],
                          signal,
                        }),
                      ),
                    );
                    suggestions = written[0].suggestions || [];
                    source = written.some((item) => item.source === "studio")
                      ? "studio"
                      : "request";
                    // Each prompt becomes count prompts, written or repeated, so every image is one job.
                    plan.prompts = written.flatMap((item) =>
                      item.source === "studio"
                        ? item.prompts
                        : Array.from({ length: count }, () => item.prompts[0]),
                    );
                    plan.count = 1;
                  }
                  return { profile, note, plan, source, suggestions };
                }),
              );
        if (preview) {
          if (previews.size >= 256) previews.delete(previews.keys().next().value);
          previews.set(previewKey, { at: Date.now(), plans });
          const suggestions = plans.flatMap((item) => item.suggestions);
          const lines = plans.map(
            ({ profile, plan }) =>
              `${profile.label || profile.id}: ${[...new Set(plan.prompts)].map(shortPrompt).join(" | ")}`,
          );
          return {
            content: [
              {
                type: "text",
                text: `Preview only; nothing is queued. Show the user these${suggestions.length ? " suggestions and" : ""} prompts and wait. To queue exactly these prompts, call Generate again with the same arguments without preview; for changes, call it with a revised request.\n\n${suggestions.length ? `Suggestions:\n${suggestions.map((item) => `- ${item}`).join("\n")}\n\n` : ""}${lines.join("\n")}`,
              },
            ],
          };
        }
        // Request and prompts together: the prompts run, and the request stays on the record for Reuse.
        const recordOf = ({ source, plan }) => {
          const base = request || (apply_guide && args.prompts.length === 1 ? args.prompts[0] : "");
          const assistant = actor.assistant
            ? chatAssistant.record(owner, plan.prompts || [], plan.loras || [])
            : null;
          return {
            ...(base ? { request: base, styled: source !== "exact" } : {}),
            ...(assistant ? { assistant } : {}),
          };
        };
        const contextNote =
          request && args.prompts
            ? "The prompts ran as given; the request is kept as context. "
            : "";
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
          return respondSets(sets, contextNote, signal, await comparisonOf(sets));
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
        const submission = await submit(profile, plan, recordOf({ source, plan }));
        return respond(
          submission.queued,
          profile,
          signal,
          submission.guide,
          source,
          `${contextNote}${tierNote || ""}${faceNote}`,
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
      tool(
        server,
        "Upload",
        "Upload Reference",
        "Upload a PNG, JPEG or WebP reference image (base64, at most 20 MB) for Generate.",
        {
          content_base64: z.string().min(1).max(28000000),
          filename: z.string().default("reference.png"),
        },
        async ({ content_base64, filename }) =>
          mcpJson(await media.upload(owner, content_base64, filename)),
      );
      tool(
        server,
        "Reuse",
        "Reuse Result",
        `Follow up on one finished result. mode again (default) reruns it with a new seed: request changes it in words, prompt replaces its prompt, preserve_seed keeps its seed. mode animate makes an image a video. Either way, tier or profile_id picks the model. mode reference returns it as a reference_asset_id for Generate.`,
        {
          ...output,
          job_id: z
            .string()
            .min(1)
            .max(200)
            .describe('Its ref as the reply shows it ("result 1"), or a job_id; never "all".'),
          mode: z.enum(["again", "animate", "reference"]).default("again"),
          request: z.string().trim().min(1).max(2000).optional(),
          prompt: z.string().trim().min(1).optional(),
          tier: tier.optional(),
          profile_id: z.string().min(1).optional(),
          preserve_seed: z.boolean().default(false),
          count: jobCount.default(1),
        },
        async (
          {
            job_id,
            output_index,
            mode,
            tier: wanted,
            profile_id,
            preserve_seed,
            request,
            prompt,
            count,
          },
          signal,
        ) => {
          const id = resolve(job_id);
          if (mode === "reference") {
            if (wanted || prompt || request || profile_id || preserve_seed || count > 1)
              throw new Error(
                "mode reference takes only job_id and output_index. To generate from this result, call Reuse with mode again or animate.",
              );
            const result = await media.download(owner, id, output_index);
            if (!["image/png", "image/jpeg", "image/webp"].includes(result.mime))
              throw new Error("Only images can be reused as references.");
            return mcpJson(
              await media.upload(
                owner,
                result.content.toString("base64"),
                `reference.${result.mime.split("/")[1]}`,
              ),
            );
          }
          if (prompt && request)
            throw new Error(
              "Use either request (a change in words) or prompt (an exact new prompt), not both. Call Reuse again with only one of them.",
            );
          const item = await media.source(owner, id, output_index);
          const own = item.type === "video" ? "video" : "image";
          if (mode === "animate" && own === "video")
            throw new Error("This result is already a video; call Reuse with mode again instead.");
          const kind = mode === "animate" ? "video" : own;
          if (preserve_seed && (kind !== own || wanted || profile_id))
            throw new Error(
              "preserve_seed is for a same-model revision, not animation or a model/tier change. Call Reuse again without preserve_seed.",
            );
          let plan;
          // Animating may name the video model ("grok imagine") in profile_id; naming a cloud profile asks for the cloud.
          const named =
            kind !== own && profile_id
              ? namedInTier(await media.profiles("video", owner), profile_id, wanted)
              : null;
          const cloud =
            asksForCloud(request) ||
            asksForCloud(prompt) ||
            Boolean(named && isCloudProfile(named.profile));
          if (kind !== own)
            plan = await media.animate(owner, id, output_index, item, {
              tier: wanted,
              count,
              cloud,
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
          // Changes re-expand the original request for the target profile, so no prompt or guide piles up in the chat.
          const recorded = media.promptRecord(id);
          const base = recorded?.request || item.prompt;
          const changes = [...(recorded?.changes || []), ...(request ? [request] : [])].slice(-8);
          const moved = kind !== own || Boolean(wanted || profile_id);
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
          if (prompt) usePrompts(plan.args, { prompts: [prompt], source: "exact" }, count);
          else if (request || (moved && writer)) {
            const references = plan.args.reference_asset_ids?.length || 0;
            const fallback = [request ? `${item.prompt}, ${request}` : item.prompt];
            source = usePrompts(
              plan.args,
              await write(plan.profile, {
                request: base,
                changes,
                count,
                references,
                role:
                  kind !== own
                    ? "first-frame"
                    : references
                      ? item.settings?.referenceRole || "reference"
                      : "",
                fallback,
                signal,
              }),
              count,
            );
          }
          // A plain run again keeps the result's prompt, so it keeps how that prompt was written (Recreate does the same).
          const carried =
            !prompt && !request && !moved && source === "exact"
              ? item.assistant || recorded?.assistant
              : null;
          const submission = await submit(plan.profile, plan.args, {
            ...(prompt
              ? { request: prompt }
              : { request: base, changes, styled: source !== "exact" }),
            ...(carried ? { assistant: carried } : {}),
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
      const ask = createControlClient(environment, fetchImpl);
      const control = async (method, route, body) => {
        try {
          return await ask(method, route, body);
        } catch {
          throw new Error(
            "AI Control is unavailable or refused the request. Refresh its status and preview before retrying.",
          );
        }
      };
      const request = async (method, route, body) => mcpJson(await control(method, route, body));
      /** A preset board: image with text, image with video, or video on both GPUs. Text keeps the running single-GPU model unless one is named. */
      const modeAllocation = async (mode, textProfile) => {
        if (mode === "image_video")
          return [
            { profile: "comfyui-image", devices: ["0"] },
            { profile: "comfyui-video", devices: ["1"] },
          ];
        if (mode === "video") return [{ profile: "comfyui-video", devices: ["0", "1"] }];
        const [status, catalogue] = await Promise.all([
          control("GET", "status"),
          control("GET", "catalogue"),
        ]);
        const workloads = catalogue?.rules?.workloads || {};
        const fits = Object.keys(workloads).filter(
          (id) => workloads[id].kind === "text" && workloads[id].placements?.includes("0"),
        );
        const running = status?.runtimes?.text?.running ? status.runtimes.text.profile : "";
        const text = textProfile || (fits.includes(running) ? running : "");
        if (!fits.includes(text))
          throw new Error(`Name text_profile, a text model that fits one GPU: ${fits.join(", ")}.`);
        return [
          { profile: text, devices: ["0"] },
          { profile: "comfyui-image", devices: ["1"] },
        ];
      };
      tool(
        server,
        "GPUStatus",
        "GPU Status",
        "Read GPU allocation and runtime health.",
        {},
        () => request("GET", "status"),
        { readOnlyHint: true },
      );
      tool(
        server,
        "Workloads",
        "List Workloads",
        "List workloads and placement rules for an explicitly requested allocation.",
        {},
        () => request("GET", "catalogue"),
        { readOnlyHint: true },
      );
      tool(
        server,
        "Preview",
        "Preview Allocation",
        "Preview a COMPLETE GPU board without applying it; omitted workloads stop and an empty board stops all. Present the changes for approval; discard to cancel.",
        { allocation },
        (args) => request("POST", "board/plan", args),
        { readOnlyHint: true },
      );
      tool(
        server,
        "Apply",
        "Apply Allocation",
        "Apply an explicitly requested allocation only after its Preview was presented and approved, with its exact signature. Active jobs may stop; never use it for media generation.",
        { allocation, signature: z.string().min(1), confirmed: z.boolean().default(false) },
        ({ allocation, signature, confirmed }) => {
          if (!confirmed)
            throw new Error(
              "Present the preview and obtain approval before applying this allocation.",
            );
          return request("POST", "board", { allocation, replace: true, signature });
        },
        { destructiveHint: true },
      );
      tool(
        server,
        "Mode",
        "Preview GPU Mode",
        "Preview a preset board only when the user asks for it: image_text (text on GPU 0, image on GPU 1), image_video (image on GPU 0, video on GPU 1) or video (video on both GPUs). image_text keeps the running text model when it fits one GPU; otherwise pass text_profile. Present the changes for approval, then Apply the returned allocation and signature.",
        {
          mode: z.enum(["image_text", "image_video", "video"]),
          text_profile: z.string().min(1).optional(),
        },
        async ({ mode, text_profile }) => {
          const board = await modeAllocation(mode, text_profile);
          return mcpJson({
            allocation: board,
            ...(await control("POST", "board/plan", { allocation: board })),
          });
        },
        { readOnlyHint: true },
      );
      tool(
        server,
        "Restart",
        "Restart Workload",
        "Restart a running workload in place, only when the user asks: the same model, profile and GPUs. Its active jobs stop. runtime is a runtime name from GPUStatus, such as text, image or comfyui-video. Never starts a stopped workload or changes allocation.",
        { runtime: z.string().min(1) },
        async ({ runtime }) => {
          const current = (await control("GET", "status"))?.runtimes?.[runtime];
          if (!current?.running)
            throw new Error(`${runtime} is not running; only a running workload can be restarted.`);
          return request("POST", "restart", {
            runtime,
            profile: current.profile,
            devices: current.devices,
          });
        },
        { destructiveHint: true },
      );
      tool(
        server,
        "Operation",
        "Check Operation",
        "Read the job returned by Apply, without waiting.",
        { job_id: z.string().regex(/^[a-zA-Z0-9]{1,64}$/) },
        ({ job_id }) => request("GET", `jobs/${job_id}`),
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
  // Export's signed bundle links (mcp-admin.js): the file Settings › Profiles › Export wrote, for an hour.
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
  if (media && exportsDir)
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
  if (media)
    app.get("/mcp/results/:token", async (req, res) => {
      try {
        if (
          !allowedHost(req) &&
          req.headers.host?.toLowerCase() !== parsedPublic.host.toLowerCase()
        )
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
  return { endWaits: () => media.endWaits() };
}
