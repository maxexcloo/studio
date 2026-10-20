// SPDX-License-Identifier: AGPL-3.0-only
// Native port of the HEISS MCP service; see mcp.LICENSE.
import crypto from 'node:crypto';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { hostAllowed } from './request-guard.js';
import { closest, mcpControls, mcpGenerationCount, mcpLoras, mcpSize } from './mcp-controls.js';
import { McpMedia, maxJobsPerCall, mcpJson, mcpOutputPath } from './mcp-media.js';
import { loadMcpPrompting } from './mcp-prompting.js';
import { fastestFirst, findProfile, mcpTiers, profilesForTier, tierOf } from './mcp-tiers.js';
import { createPromptWriter } from './prompt-writer.js';

// Long enough for a cold image model load, so most images return inline instead of through a separate Result call.
export const generateWaitSeconds = 60;
const maxGenerateWaitSeconds = 60;
// Every client gets the same workflow rules from Studio itself; tool descriptions and each reply carry the details,
// so hosts that resend these every step stay small.
const tierWords = '"turbo", "super fast" or "draft" → turbo; "fast" or "quick" → fast; "best" or "high quality" → quality; else omit';
const mediaInstructions = (writing) => `Studio makes images and videos. For a new request, call Generate once with request (the user's words, with anything they refer back to), kind and tier (${tierWords}). ${writing
  ? "Studio writes the prompt; don't expand the request."
  : "Write request as one clear prompt that keeps the user's subjects and scene."} "landscape" or "16:9" is aspect and "2K" size. For a follow-up on a result ("again", "warmer", "with Krea", "animate it"), call Reuse with its ref${writing ? ' and the change as request' : ' and, to change it, a new prompt'}. Reply as each result says; if queued, share the result links and end the turn. Call Result only when the user asks to see results (job_id "all" for all). Never poll, resubmit or invent results.`;
const controlInstructions = 'GPU allocation is manual: use these tools only on explicit request, and present a Preview or Mode preview and get approval before Apply. Restart only what the user names. Media generation never changes allocation.';
const unlinkedMessage = 'This chat account isn’t linked to a Studio account yet. Ask an administrator to link it in Settings › Accounts & MCP.';
const anonymousMessage = 'The gateway must forward its user identity.';
/** Schema refusals arrive as one issue per line ("Too big: … at wait_seconds"); one line naming each field is enough to fix the call. */
const conciseError = (message) => {
  const match = /Invalid arguments for tool (\w+): ([\s\S]+)$/.exec(String(message));
  if (!match) return message;
  const issues = match[2].split('\n').filter(Boolean).map(line => /^(.+) at (\S+)$/.exec(line)?.slice(1).reverse().join(': ') || line);
  return `Fix the ${match[1]} arguments: ${issues.join('; ')}.`;
};
const equal = (left, right) => Boolean(left && right && Buffer.byteLength(left) === Buffer.byteLength(right) && crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right)));
const wait = (max) => z.number().int().min(0).max(max).default(0);
const job = { job_id: z.string().min(1).max(200).describe('A job_id or ref such as "result 3".') };
const output = { ...job, output_index: z.number().int().min(0).max(999).default(0) };
const tier = z.enum(mcpTiers).describe('turbo is Super Fast.');
// A prompting guide is long; chat gets its essentials once, and Models returns the full guide.
const maxGuideCharacters = 1200;
/** A profile guide's essentials as one capped paragraph: summary, rules and pitfalls, without sources or examples. */
export function compactGuide(guide) {
  if (!guide || typeof guide !== 'object') return '';
  const parts = [];
  const add = (value) => { for (const item of [value].flat()) if (typeof item === 'string' && item.trim()) parts.push(item.replace(/\s+/g, ' ').trim()); };
  for (const source of [guide, guide.mode, guide.variant]) if (source && typeof source === 'object') { add(source.summary); add(source.rules); add(source.pitfalls); }
  const textValue = parts.join(' ');
  return textValue.length > maxGuideCharacters ? `${textValue.slice(0, maxGuideCharacters - 1)}…` : textValue;
}
// The prompt a result ran, as the chat shows it; the result page has the full text.
const maxShownPromptCharacters = 200;
const shortPrompt = (prompt) => {
  const flat = String(prompt).replace(/\s+/g, ' ').trim();
  return (flat.length > maxShownPromptCharacters ? `${flat.slice(0, maxShownPromptCharacters - 1)}…` : flat).replace(/[\\`*_[\]<>#|]/g, '\\$&');
};
const allocation = z.array(z.object({ profile: z.string().min(1), devices: z.array(z.string().min(1)).min(1) }).strict()).max(32);

/** Optional authenticated MCP on the studio's existing HTTP(S) server. */
export function registerMcpRoutes(app, { dataDir, baseUrl, environment = process.env, foregroundWaitSeconds = 20, imageWaitSeconds = generateWaitSeconds, fetchImpl = fetch, allowedHost = (req) => hostAllowed(req.headers.host), accountMode = false, authenticateAccountToken = () => null, authenticateGatewayIdentity = () => null, noteGatewayIdentity = () => {}, internalCredential = () => ({}), resolveSignedResult } = {}) {
  const mediaKey = environment.STUDIO_MCP_API_KEY;
  const controlKey = environment.CONTROL_MCP_API_KEY;
  if (!mediaKey && !controlKey && !accountMode) return false;
  if (controlKey && (!environment.CONTROL_URL || !environment.CONTROL_API_KEY || equal(controlKey, mediaKey) || equal(controlKey, environment.CONTROL_API_KEY) || equal(mediaKey, environment.CONTROL_API_KEY))) throw new Error('AI Control requires separate MCP/media/upstream credentials and CONTROL_URL.');
  const publicUrl = environment.MCP_PUBLIC_URL?.replace(/\/+$/, '') || (typeof baseUrl === 'function' ? baseUrl() : baseUrl);
  const parsedPublic = new URL(publicUrl);
  if (!['http:', 'https:'].includes(parsedPublic.protocol) || parsedPublic.username || parsedPublic.password || parsedPublic.search || parsedPublic.hash) throw new Error('MCP_PUBLIC_URL must be an absolute HTTP(S) base URL without credentials, query or fragment.');
  const media = mediaKey || accountMode ? new McpMedia({ dataDir, baseUrl, publicUrl: environment.MCP_PUBLIC_URL ? publicUrl : () => typeof baseUrl === 'function' ? baseUrl() : baseUrl, signingKey: environment.MCP_SIGNING_KEY, fetchImpl, resolveSignedResult }) : null;
  // A chat model waiting on Status or a preview can block its chat; only notification deliveries wait longer.
  const foregroundWait = foregroundWaitSeconds;
  // Only a notification delivery, which collects a queued job, may hold a request open for long.
  const capWait = (seconds, delivery) => delivery === 'notification' ? seconds : Math.min(seconds, foregroundWait);
  const prompting = loadMcpPrompting(environment.MCP_PROMPTING_PATH);
  // Optional: with a writer, Studio writes each prompt from the request; a partial setting fails at start.
  const writer = createPromptWriter(environment, { fetchImpl });
  const instructions = mediaInstructions(Boolean(writer));
  // The studio's rescan or any model change refreshes MCP's per-owner catalogue cache.
  if (media) app.use('/api/models', (req, _res, next) => {
    if (req.method !== 'GET' ? true : req.path === '/' && req.query.cached !== '1') media.invalidateProfiles();
    next();
  });
  const reviewedGuides = new Map();
  // Stateless transport: a client's notifications/cancelled arrives on its own POST, so waits are found by actor and request id.
  const inflight = new Map();
  const inflightKey = (actor, requestId) => JSON.stringify([actor.scope, actor.owner, String(requestId)]);
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
    res.set('Cache-Control', 'private, no-store');
    if (!allowedHost(req) && req.headers.host?.toLowerCase() !== parsedPublic.host.toLowerCase()) return res.status(403).json({ error: 'Unrecognised MCP host.' });
    const origin = req.headers.origin;
    if (origin !== undefined) {
      let own = false;
      try { own = new URL(origin).origin === parsedPublic.origin || new URL(origin).host.toLowerCase() === req.headers.host?.toLowerCase(); } catch { /* Invalid origins are rejected. */ }
      if (!own) return res.status(403).json({ error: 'Cross-origin MCP requests are not permitted.' });
    }
    const token = /^Bearer ([^\s]+)$/i.exec(String(req.headers.authorization || ''))?.[1];
    const user = String(req.headers['x-ai-user-id'] || '');
    if (user.length > 256 || /[\x00-\x1f\x7f]/.test(user)) return res.status(400).json({ error: 'Invalid forwarded user identity.' });
    let account = null;
    let scope = '';
    if (!accountMode) scope = equal(token, mediaKey) ? 'media' : equal(token, controlKey) ? 'control' : '';
    else if (equal(token, controlKey)) scope = 'control';
    else if (equal(token, mediaKey)) {
      // Gateway trust: the shared key vouches for the gateway; only a link (an administrator's, or by matching email) maps its user to an account.
      // The gateway's own health checks and handshakes name no user: they connect and list, and every call is refused.
      const email = String(req.headers['x-ai-user-email'] || '');
      if (email.length > 256 || /[\x00-\x1f\x7f]/.test(email)) return res.status(400).json({ error: 'Invalid forwarded user email.' });
      account = user ? authenticateGatewayIdentity(user, email) : null;
      if (!user) scope = 'anonymous';
      else if (account) {
        scope = 'media';
        media.credentials.set(account.userId, internalCredential(account.userId));
      } else {
        // Listed tools that each explain the missing link read better in a chat than a refused connection.
        noteGatewayIdentity(user);
        scope = 'unlinked';
      }
    } else {
      account = authenticateAccountToken(token);
      if (account) {
        scope = 'media';
        media.credentials.set(account.userId, { Authorization: `Bearer ${token}` });
      }
    }
    if (!scope) return res.status(401).set('WWW-Authenticate', 'Bearer realm="Studio MCP"').json({ error: 'A valid MCP bearer credential is required.' });
    const conversation = String(req.headers['x-studio-conversation-id'] || '');
    if (conversation.length > 256 || /[\x00-\x1f\x7f]/.test(conversation)) return res.status(400).json({ error: 'Invalid conversation identity.' });
    const owner = account?.userId || (scope === 'media' ? media.owner(user, token) : null);
    // Result numbers ("result 3") are per conversation when the client names one, otherwise per account.
    req.mcpActor = { scope, owner, refs: scope === 'media' && owner ? media.referenceScope(owner, conversation) : '' };
    next();
  };
  const create = (actor) => {
    const { scope, owner, refs } = actor;
    const tool = (server, name, title, description, inputSchema, action, annotations = {}) => server.registerTool(name, { title, description, inputSchema, annotations: { readOnlyHint: false, destructiveHint: false, ...annotations } }, async (args, extra = {}) => {
      // The SDK aborts extra.signal when the client disconnects; a cancellation notification aborts it here.
      const controller = new AbortController();
      const forward = () => controller.abort();
      if (extra.signal?.aborted) controller.abort(); else extra.signal?.addEventListener('abort', forward, { once: true });
      const key = extra.requestId === undefined ? null : inflightKey(actor, extra.requestId);
      if (key) inflight.set(key, controller);
      try {
        if (scope === 'unlinked') throw new Error(unlinkedMessage);
        if (scope === 'anonymous') throw new Error(anonymousMessage);
        return await action(args, controller.signal);
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error?.message || 'Studio could not complete this request.' }] };
      } finally {
        extra.signal?.removeEventListener('abort', forward);
        if (key && inflight.get(key) === controller) inflight.delete(key);
      }
    });
    const resolve = (value) => media.resolve(owner, refs, value);
    /** A submission's reply: finished markdown when every job ends within the wait, otherwise result links for the queued jobs, which end the agent's turn. */
    const respond = async (submission, profile, waitSeconds, signal, guide = '', promptSource = 'exact') => {
      const label = profile.label || profile.id;
      // A cloud fallback is named up front: it is not the local model the user may expect, and it can cost money.
      const note = profile.remote ? `The local video worker is unavailable, so this video runs on the cloud profile ${label}; tell the user. ` : '';
      // Quick jobs come back finished, so the agent needs no Result call.
      const seconds = waitSeconds ?? (profile.kind === 'video' ? 0 : imageWaitSeconds);
      const markdown = await media.settle(owner, submission, seconds, { signal });
      const structured = { status: markdown ? 'done' : submission.status, profile: { id: profile.id, label, tier: tierOf(profile), ...(profile.remote ? { remote: true } : {}) }, prompt_source: promptSource, jobs: submission.jobs.map(({ job_id, ref, link, status }) => ({ job_id, ref, link, ...(status ? { status } : {}) })), ...(guide ? { prompting: guide } : {}) };
      // The prompt each result ran, shortened; one line when every job shares it.
      const prompted = submission.jobs.filter(({ prompt }) => prompt);
      const distinct = new Set(prompted.map(({ prompt }) => prompt));
      const prompts = !prompted.length ? '' : `\n\n${distinct.size === 1 ? `Prompt: ${shortPrompt([...distinct][0])}` : prompted.map(({ ref, prompt }) => `${ref[0].toUpperCase()}${ref.slice(1)} prompt: ${shortPrompt(prompt)}`).join('\n')}`;
      // The profile's guide follows its first use in a conversation, so the agent applies it to later prompts.
      const extra = guide ? [{ type: 'text', text: `Prompting guide for ${label} (sent once; Models with profile_id has the full guide); apply it to later prompts: ${guide}` }] : [];
      // Several results, or any still running, also get one All Results page that fills in as they finish.
      const all = `[All Results](${media.allUrl(owner, refs)})`;
      if (markdown) return { content: [{ type: 'text', text: `Done. ${note}Reply with the markdown below exactly, plus at most one short sentence. Do not call Studio again.\n\n${markdown}${submission.jobs.length > 1 ? `\n\n${all}` : ''}${prompts}` }, ...extra], structuredContent: structured };
      const pending = [...submission.jobs.map(({ ref, link }) => `[${ref[0].toUpperCase()}${ref.slice(1)}](${link})`), all].join(' · ');
      const message = submission.status === 'queued'
        ? `Queued. ${note}Share the links below and end your turn; do not call Result now. When the user later asks to see results, call Result. Never poll or resubmit.`
        : `${submission.error} ${note}Share the links; never resubmit.`;
      return { content: [{ type: 'text', text: `${message}\n\n${pending}${prompts}` }, ...extra], structuredContent: { ...structured, ...(submission.error ? { error: submission.error } : {}) } };
    };
    /** A ready profile by id or name, the fastest of one family's matches; otherwise the closest few, fastest first, so one call corrects a guess. */
    const profileNamed = (profiles, value) => {
      const found = findProfile(profiles, value);
      if (found) return found;
      const near = closest(fastestFirst(profiles), value, profile => [profile.id, profile.label, tierOf(profile)]);
      throw new Error(`No ready profile matches ${value}.${near.length ? ` Closest: ${near.map(profile => `${profile.id} (${profile.label || profile.id})`).join(', ')}.` : ' Call Models for the list.'}`);
    };
    /**
     * Queues a submission with the request behind it. Without a prompt writer, the profile's guide goes to a
     * conversation that has not had it, marked before any wait; with one, the chat never needs it.
     */
    const submit = async (profile, args, record = {}) => {
      const fresh = !writer && review(refs, profile.id);
      try {
        const queued = await media.queue(owner, args, refs, record);
        return { queued, guide: fresh ? compactGuide(prompting(profile, true)) : '' };
      } catch (error) {
        // A refused submission delivered no guide, so the next attempt carries it.
        if (fresh) reviewedGuides.delete(guideKey(refs, profile.id));
        throw error;
      }
    };
    /** Prompts for a target profile: written from the request and its changes, or the fallback when writing is off or fails. */
    const write = async (profile, { request, changes = [], count, references = 0, role = '', fallback, signal }) => {
      if (!writer) return { prompts: fallback, source: 'request' };
      const guided = references && profile.imageModes?.reference ? { ...profile, ...profile.imageModes.reference } : profile;
      return writer.write({ profile, guide: prompting(guided, true), request, changes, count, references, role, fallback, signal });
    };
    /** Sets a plan's prompts from what was written: one each, or the fallback with the requested count. */
    const usePrompts = (args, written, count) => {
      if (written.source === 'studio') Object.assign(args, { prompts: written.prompts, count: 1 });
      else Object.assign(args, { prompts: written.prompts, count });
      return written.source;
    };
    const server = new McpServer({ name: 'Studio', version: '1.0.0' }, { instructions: scope === 'control' ? controlInstructions : instructions });
    const toolError = server.createToolError.bind(server);
    server.createToolError = (message) => toolError(conciseError(message));
    if (scope === 'media' || scope === 'unlinked' || scope === 'anonymous') {
      tool(server, 'Models', 'Find Models', 'List ready profiles as "id — label" by kind. With profile_id (an id or label), return its prompting guide, defaults, adjustable controls, reference slots and an index of compatible LoRAs; lora_query or lora_names returns full details for up to five LoRAs. Not needed for ordinary requests.', { kind: z.enum(['all', 'image', 'video']).default('all'), tier: tier.optional(), profile_id: z.string().optional(), lora_query: z.string().max(200).optional().describe('Looks up LoRAs by name, title or trigger.'), lora_names: z.array(z.string().min(1)).max(5).optional() }, async ({ kind, tier: wanted, profile_id, lora_query, lora_names = [] }) => {
        let profiles = await media.profiles(kind, owner);
        if (profile_id === undefined) {
          if (wanted) profiles = profilesForTier(profiles, wanted);
          const list = {};
          for (const profile of profiles) (list[profile.kind] ||= []).push(profile.label && profile.label !== profile.id ? `${profile.id} — ${profile.label}` : profile.id);
          return mcpJson(list);
        }
        const profile = profileNamed(profiles, profile_id);
        const infos = profile.options?.loras?.length && profile.capabilities?.lora !== false ? await media.loraInfos(owner) : {};
        const controls = mcpControls(profile);
        // A LoRA lookup answers only that question; the profile's guide and controls come without one.
        if (controls.loras && (lora_query || lora_names.length)) {
          const { loras, total, more, missing } = mcpLoras(profile, infos, { query: lora_query, names: lora_names });
          return mcpJson({ id: profile.id, loras, loras_total: total, ...(more ? { more_matches: more } : {}), ...(missing ? { missing } : {}) });
        }
        review(refs, profile.id);
        // Defaults only for adjustable controls: a fixed value is not something to choose.
        const defaults = Object.fromEntries(Object.entries({ ...profile.defaults, count: mcpGenerationCount }).filter(([key]) => controls[key] || ['frames', 'fps', 'duration'].includes(key)));
        const modes = profile.imageModes && Object.fromEntries(Object.entries(profile.imageModes).map(([mode, settings]) => {
          // The same merge Generate validates against when references select this mode.
          const merged = { ...profile, ...settings };
          return [mode, { controls: mcpControls(merged), ...(settings?.prompting ? { prompting: settings.prompting } : {}) }];
        }));
        const { loras, total } = mcpLoras(profile, infos);
        const detail = {
          ...Object.fromEntries(['id', 'label', 'kind', 'family', 'description', 'mediaInputs', 'aspectPolicy', 'aspectPresets', 'native'].filter(key => key in profile).map(key => [key, profile[key]])),
          tier: tierOf(profile), defaults, controls, ...(modes ? { imageModes: modes, imageModes_note: 'A mode applies when its media is supplied, such as reference with references.' } : {}),
          ...(controls.loras ? { loras, loras_total: total, loras_note: 'Each reads name — hint [trigger word]. Pass names to Generate; strength defaults to the recommended value. Put the trigger word in the prompt.' } : {}),
          prompting: prompting(profile, true)
        };
        return mcpJson(detail);
      }, { readOnlyHint: true });
      tool(server, 'Generate', 'Generate', `Queue images or videos. Pass request with kind and tier; Studio picks the profile${writer ? ' and writes the prompt' : ''}. count: images, at most four per call. profile_id (id, label or family) and loras (names) choose the model. prompts (one per different image), or exact_prompt, use your text verbatim. Pass only controls Models lists. Never switches GPUs.`, {
        request: z.string().trim().min(1).max(4000).optional(), exact_prompt: z.boolean().optional(),
        profile_id: z.string().min(1).optional(), kind: z.enum(['image', 'video']).optional().describe('Default image.'), tier: tier.optional(), prompts: z.array(z.string().trim().min(1)).min(1).max(4).optional(),
        loras: z.array(z.object({ name: z.string().min(1), strength: z.number().finite().optional() }).strict()).max(32).optional(), reference_asset_ids: z.array(z.string().min(1)).max(16).optional(), reference_role: z.enum(['edit', 'reference']).optional(),
        aspect: z.string().optional().describe('landscape, portrait, square or a ratio like 16:9; prefer to width/height.'), size: z.enum(['2k', '4k']).optional(),
        width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), count: z.number().int().min(1).max(4).optional().describe('Default 1; per prompt with prompts.'), steps: z.number().int().positive().optional(), seed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 4).optional(),
        wait_seconds: z.number().int().min(0).max(maxGenerateWaitSeconds).optional(), negative_prompt: z.string().optional(), cfg: z.number().finite().optional(), denoise: z.number().finite().optional(), sampler: z.string().optional(), scheduler: z.string().optional(), upscale_quality: z.enum(['fast', 'balanced', 'high']).optional(), face_detail: z.boolean().default(false)
      }, async ({ kind, tier: wanted, wait_seconds, aspect, size, request, exact_prompt, ...args }, signal) => {
        if (Boolean(request) === Boolean(args.prompts)) throw new Error(request ? 'Pass request or prompts, not both.' : "Pass request with the user's words.");
        // "count: 4" beside four prompts means one image each, not sixteen.
        if (args.count > 1 && args.count === args.prompts?.length && args.count * args.prompts.length > maxJobsPerCall) args.count = 1;
        const profile = args.profile_id === undefined
          ? await media.choose(owner, { kind, tier: wanted, references: args.reference_asset_ids?.length || 0, loras: args.loras || [] })
          : profileNamed(await media.profiles(kind || 'all', owner), args.profile_id);
        const sized = mcpSize(profile, { aspect, size });
        if (sized && (args.width !== undefined || args.height !== undefined)) throw new Error('Pass aspect and size, or width and height, not both.');
        let source = 'exact';
        if (request) {
          const count = args.count ?? 1;
          const references = args.reference_asset_ids?.length || 0;
          const written = exact_prompt ? { prompts: [request], source: 'exact' } : await write(profile, { request, count, references, role: references ? args.reference_role || 'reference' : '', fallback: [request], signal });
          source = usePrompts(args, written, count);
        }
        const submission = await submit(profile, { ...args, ...sized, profile_id: profile.id }, request ? { request } : {});
        return respond(submission.queued, profile, wait_seconds, signal, submission.guide, source);
      });
      tool(server, 'Status', 'Check Status', 'Return a job\u2019s status and finished output links. Only when the user asks.', { ...job, wait_seconds: wait(20) }, async ({ job_id, wait_seconds }, signal) => {
        const id = resolve(job_id);
        const status = await media.job(owner, id, capWait(wait_seconds), { signal });
        const ref = media.refOf(owner, refs, id);
        return mcpJson({ job_id: id, ...(ref ? { ref } : {}), link: media.pageUrl(owner, id), ...media.summary(status), outputs: (status.outputs || []).flatMap((item, index) => mcpOutputPath(item.url) ? [{ output_index: index, url: media.url(owner, id, index) }] : []) });
      }, { readOnlyHint: true });
      tool(server, 'Result', 'Show Result', 'Show results as markdown to reply with, only when the user asks ("show result 3"; job_id "all" for "show them" or "show me all"). wait_seconds up to 20 allows a nearly finished job to end. A job still running returns its link: share it and stop. Never poll.', { ...output, job_id: z.string().min(1).max(200), delivery: z.enum(['notification', 'preview']).default('preview'), wait_seconds: wait(1800), detail: z.boolean().default(false).describe('Adds the JSON record to a notification.') }, ({ job_id, output_index, delivery, wait_seconds, detail }, signal) => /^\s*all\s*$/i.test(job_id) ? media.resultsAll(owner, refs, { signal }) : media.result(owner, resolve(job_id), output_index, capWait(wait_seconds, delivery), delivery, { scope: refs, signal, detail }), { readOnlyHint: true });
      tool(server, 'Cancel', 'Cancel', 'Cancel a job when the user asks.', job, async ({ job_id }) => {
        const id = resolve(job_id);
        media.own(owner, id);
        await media.job(owner, id);
        return mcpJson(await media.request('POST', `/api/jobs/${encodeURIComponent(id)}/cancel`, {}, owner));
      }, { destructiveHint: true });
      tool(server, 'Upload', 'Upload Reference', 'Upload a PNG, JPEG or WebP image (base64, at most 20 MB) as a reference asset for Generate.', { content_base64: z.string().min(1).max(28000000), filename: z.string().default('reference.png') }, async ({ content_base64, filename }) => mcpJson(await media.upload(owner, content_base64, filename)));
      tool(server, 'Reuse', 'Reuse Result', `Follow up on one finished result. Same kind: run again with a new seed; request applies a change, prompt replaces it, tier or profile_id picks another model. kind=video animates an image. Without kind, returns it as a Generate reference.`, {
        ...output, job_id: z.string().min(1).max(200).describe('Its ref as the reply header shows it ("result 1") or job_id, never "all". Link ids work; refs are preferred.'), kind: z.enum(['image', 'video']).optional(), tier: tier.optional(), profile_id: z.string().min(1).optional(),
        request: z.string().trim().min(1).max(2000).optional(), prompt: z.string().trim().min(1).optional(), count: z.number().int().min(1).max(4).default(1),
        wait_seconds: z.number().int().min(0).max(maxGenerateWaitSeconds).optional()
      }, async ({ job_id, output_index, kind, tier: wanted, profile_id, request, prompt, count, wait_seconds }, signal) => {
        const id = resolve(job_id);
        if (!kind) {
          if (wanted || prompt || request || profile_id) throw new Error('Pass kind to generate from this result.');
          const result = await media.download(owner, id, output_index);
          if (!['image/png', 'image/jpeg', 'image/webp'].includes(result.mime)) throw new Error('Only images can be reused as references.');
          return mcpJson(await media.upload(owner, result.content.toString('base64'), `reference.${result.mime.split('/')[1]}`));
        }
        if (prompt && request) throw new Error('Pass request (a change in words) or prompt (an exact new prompt), not both.');
        const item = await media.source(owner, id, output_index);
        const own = item.type === 'video' ? 'video' : 'image';
        if (kind !== own && own === 'video') throw new Error('A video result can only run again as a video.');
        if (kind !== own && profile_id) throw new Error('Pass tier, not profile_id, to choose the video model when animating.');
        let plan;
        if (kind !== own) plan = await media.animate(owner, id, output_index, item, { tier: wanted, count });
        else if (wanted || profile_id) {
          const references = (item.settings?.referenceAssets || []).filter(asset => asset?.assetId).length;
          plan = media.retarget(item, profile_id ? profileNamed(await media.profiles(kind, owner), profile_id) : await media.choose(owner, { kind, tier: wanted, references }), { count });
        } else plan = await media.rerun(owner, item, { count });
        // Changes re-expand the original request for the target profile, so no prompt or guide piles up in the chat.
        const recorded = media.promptRecord(id);
        const base = recorded?.request || item.prompt;
        const changes = [...(recorded?.changes || []), ...(request ? [request] : [])].slice(-8);
        const moved = kind !== own || Boolean(wanted || profile_id);
        let source = 'exact';
        if (prompt) usePrompts(plan.args, { prompts: [prompt], source: 'exact' }, count);
        else if (request || (moved && writer)) {
          const references = plan.args.reference_asset_ids?.length || 0;
          const fallback = [request ? `${item.prompt}, ${request}` : item.prompt];
          source = usePrompts(plan.args, await write(plan.profile, { request: base, changes, count, references, role: kind !== own ? 'first-frame' : references ? item.settings?.referenceRole || 'reference' : '', fallback, signal }), count);
        }
        const submission = await submit(plan.profile, plan.args, prompt ? { request: prompt } : { request: base, changes });
        return respond(submission.queued, plan.profile, wait_seconds, signal, submission.guide, source);
      });
    } else {
      const control = async (method, route, body) => {
        try {
          const response = await fetchImpl(`${environment.CONTROL_URL.replace(/\/+$/, '')}/api/${route}`, { method, headers: { Authorization: `Bearer ${environment.CONTROL_API_KEY}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(15000) });
          if (![200, 202].includes(response.status)) throw new Error('refused');
          return await response.json();
        } catch { throw new Error('AI Control is unavailable or refused the request. Refresh its status and preview before retrying.'); }
      };
      const request = async (method, route, body) => mcpJson(await control(method, route, body));
      /** A preset board: image with text, image with video, or video on both GPUs. Text keeps the running single-GPU model unless one is named. */
      const modeAllocation = async (mode, textProfile) => {
        if (mode === 'image_video') return [{ profile: 'comfyui-image', devices: ['0'] }, { profile: 'comfyui-video', devices: ['1'] }];
        if (mode === 'video') return [{ profile: 'comfyui-video', devices: ['0', '1'] }];
        const [status, catalogue] = await Promise.all([control('GET', 'status'), control('GET', 'catalogue')]);
        const workloads = catalogue?.rules?.workloads || {};
        const fits = Object.keys(workloads).filter(id => workloads[id].kind === 'text' && workloads[id].placements?.includes('0'));
        const running = status?.runtimes?.text?.running ? status.runtimes.text.profile : '';
        const text = textProfile || (fits.includes(running) ? running : '');
        if (!fits.includes(text)) throw new Error(`Name text_profile, a text model that fits one GPU: ${fits.join(', ')}.`);
        return [{ profile: text, devices: ['0'] }, { profile: 'comfyui-image', devices: ['1'] }];
      };
      tool(server, 'GPUStatus', 'GPU Status', 'Read GPU allocation and runtime health.', {}, () => request('GET', 'status'), { readOnlyHint: true });
      tool(server, 'Workloads', 'List Workloads', 'List workloads and placement rules for an explicitly requested allocation.', {}, () => request('GET', 'catalogue'), { readOnlyHint: true });
      tool(server, 'Preview', 'Preview Allocation', 'Preview a COMPLETE GPU board without applying it; omitted workloads stop and an empty board stops all. Present the changes for approval; discard to cancel.', { allocation }, args => request('POST', 'board/plan', args), { readOnlyHint: true });
      tool(server, 'Apply', 'Apply Allocation', 'Apply an explicitly requested allocation only after its Preview was presented and approved, with its exact signature. Active jobs may stop; never use it for media generation.', { allocation, signature: z.string().min(1), confirmed: z.boolean().default(false) }, ({ allocation, signature, confirmed }) => {
        if (!confirmed) throw new Error('Present the preview and obtain approval before applying this allocation.');
        return request('POST', 'board', { allocation, replace: true, signature });
      }, { destructiveHint: true });
      tool(server, 'Mode', 'Preview GPU Mode', 'Preview a preset board only when the user asks for it: image_text (text on GPU 0, image on GPU 1), image_video (image on GPU 0, video on GPU 1) or video (video on both GPUs). image_text keeps the running text model when it fits one GPU; otherwise pass text_profile. Present the changes for approval, then Apply the returned allocation and signature.', { mode: z.enum(['image_text', 'image_video', 'video']), text_profile: z.string().min(1).optional() }, async ({ mode, text_profile }) => {
        const board = await modeAllocation(mode, text_profile);
        return mcpJson({ allocation: board, ...await control('POST', 'board/plan', { allocation: board }) });
      }, { readOnlyHint: true });
      tool(server, 'Restart', 'Restart Workload', 'Restart a running workload in place, only when the user asks: the same model, profile and GPUs. Its active jobs stop. runtime is a runtime name from GPUStatus, such as text, image or comfyui-video. Never starts a stopped workload or changes allocation.', { runtime: z.string().min(1) }, async ({ runtime }) => {
        const current = (await control('GET', 'status'))?.runtimes?.[runtime];
        if (!current?.running) throw new Error(`${runtime} is not running; only a running workload can be restarted.`);
        return request('POST', 'restart', { runtime, profile: current.profile, devices: current.devices });
      }, { destructiveHint: true });
      tool(server, 'Operation', 'Check Operation', 'Read the job returned by Apply, without waiting.', { job_id: z.string().regex(/^[a-zA-Z0-9]{1,64}$/) }, ({ job_id }) => request('GET', `jobs/${job_id}`), { readOnlyHint: true });
    }
    return server;
  };
  app.post('/mcp', guard, express.json({ limit: '30mb' }), async (req, res) => {
    for (const message of [req.body].flat()) if (message?.method === 'notifications/cancelled' && message.params?.requestId !== undefined) {
      inflight.get(inflightKey(req.mcpActor, message.params.requestId))?.abort();
    }
    const server = create(req.mcpActor);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.once('close', () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'MCP could not complete this request.' }, id: req.body?.id ?? null });
    }
  });
  app.all('/mcp', guard, (_req, res) => res.status(405).set('Allow', 'POST').json({ error: 'Use Streamable HTTP POST for MCP.' }));
  if (media) app.get('/mcp/results/:token', async (req, res) => {
    try {
      if (!allowedHost(req) && req.headers.host?.toLowerCase() !== parsedPublic.host.toLowerCase()) throw new Error('Invalid host.');
      const claims = media.claims(req.params.token);
      if (claims.page || claims.all) {
        // Account mode reads as the signed owner through MCP's loopback credential; the studio rechecks that account's access.
        const credential = accountMode ? internalCredential(claims.owner) : undefined;
        const html = claims.all ? await media.allPage(claims, credential) : await media.page(claims, credential);
        if (!html) throw new Error('Unavailable.');
        return res.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", 'Content-Type': 'text/html; charset=utf-8' }).send(html);
      }
      const original = accountMode
        ? await media.signedResult(claims.owner, claims.jobId, claims.index)
        : await media.download(claims.owner, claims.jobId, claims.index);
      const result = claims.preview ? await media.previewOf(original) : original;
      res.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline', 'Content-Type': result.mime }).send(result.content);
    } catch { res.status(404).json({ error: 'The result link is invalid, unavailable or expired.' }); }
  });
  return true;
}
