// SPDX-License-Identifier: AGPL-3.0-only
// Native port of the HEISS MCP service; see mcp.LICENSE.
import crypto from 'node:crypto';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { defaultGenerationCount } from './generation-defaults.js';
import { hostAllowed } from './request-guard.js';
import { mcpControls, mcpLoras } from './mcp-controls.js';
import { McpMedia, maxResultWaitSeconds, mcpJson, mcpOutputPath } from './mcp-media.js';
import { loadMcpPrompting } from './mcp-prompting.js';
import { mcpTiers, profilesForTier, summaryOf, tierOf } from './mcp-tiers.js';

const generateWaitSeconds = 30;
const maxGenerateWaitSeconds = 60;
// Workflow rules only; tool descriptions and each reply carry the details, so hosts that resend these every step stay small.
const instructions = `Studio makes the images and videos users ask for. For an ordinary request, call Generate with kind, tier and one clear prompt that keeps the user's intent; call Models only when the user names a model, asks what is available or needs controls, LoRAs or references. For a follow-up on a result ("again", "more like that", "animate it"), call Reuse with its ref. Follow each reply's instructions: reproduce finished markdown exactly with at most a short caption, and collect queued jobs with one background Result each. Never poll, resubmit or invent results.`;
const controlInstructions = 'GPU allocation is manual: use these tools only on explicit request, and present a Preview and get approval before Apply. Media generation never changes allocation.';
const unlinkedMessage = 'This chat account isn’t linked to a Studio account yet. Ask an administrator to link it in Settings › Accounts & MCP.';
const equal = (left, right) => Boolean(left && right && Buffer.byteLength(left) === Buffer.byteLength(right) && crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right)));
const wait = (max) => z.number().int().min(0).max(max).default(0);
const job = { job_id: z.string().min(1).max(200).describe('A job_id or ref such as "result 3".') };
const output = { ...job, output_index: z.number().int().min(0).max(999).default(0) };
const tier = z.enum(mcpTiers).describe('turbo is Super Fast.');
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
  // A chat model waiting in the foreground can block its chat; only background notifications wait longer.
  const foregroundWait = foregroundWaitSeconds;
  // Only a background notification may hold a request open for long; a foreground wait blocks the chat.
  const capWait = (seconds, delivery) => delivery === 'notification' ? seconds : Math.min(seconds, foregroundWait);
  const prompting = loadMcpPrompting(environment.MCP_PROMPTING_PATH);
  // The studio's rescan or any model change refreshes MCP's per-owner catalogue cache.
  if (media) app.use('/api/models', (req, _res, next) => {
    if (req.method !== 'GET' ? true : req.path === '/' && req.query.cached !== '1') media.invalidateProfiles();
    next();
  });
  const reviewedGuides = new Map();
  // Stateless transport: a client's notifications/cancelled arrives on its own POST, so waits are found by actor and request id.
  const inflight = new Map();
  const inflightKey = (actor, requestId) => JSON.stringify([actor.scope, actor.owner, String(requestId)]);
  const guideKey = (owner, profileId) => JSON.stringify([owner, profileId]);
  const review = (owner, profileId) => {
    if (reviewedGuides.size >= 4096) reviewedGuides.delete(reviewedGuides.keys().next().value);
    reviewedGuides.set(guideKey(owner, profileId), Date.now());
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
      if (!user) return res.status(403).json({ error: 'The gateway must forward its user identity.' });
      const email = String(req.headers['x-ai-user-email'] || '');
      if (email.length > 256 || /[\x00-\x1f\x7f]/.test(email)) return res.status(400).json({ error: 'Invalid forwarded user email.' });
      account = authenticateGatewayIdentity(user, email);
      if (account) {
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
        return await action(args, controller.signal);
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error?.message || 'Studio could not complete this request.' }] };
      } finally {
        extra.signal?.removeEventListener('abort', forward);
        if (key && inflight.get(key) === controller) inflight.delete(key);
      }
    });
    const resolve = (value) => media.resolve(owner, refs, value);
    /** A submission's reply: finished markdown when every job ends within the wait, otherwise the queued jobs. */
    const respond = async (submission, profile, waitSeconds, signal, guide = {}) => {
      const summary = { id: profile.id, label: profile.label || profile.id, tier: tierOf(profile), ...(profile.remote ? { remote: true } : {}) };
      // A cloud fallback is named up front: it is not the local model the user may expect, and it can cost money.
      const note = profile.remote ? `The local video worker is unavailable, so this video runs on the cloud profile ${summary.label}. Tell the user it went to ${summary.label}.` : '';
      // Quick jobs come back finished, so the agent needs no background Result and no second turn.
      const seconds = waitSeconds ?? (profile.kind === 'video' ? 0 : imageWaitSeconds);
      const markdown = await media.settle(owner, submission, seconds, { signal });
      if (markdown) {
        const done = { status: 'done', profile: summary, jobs: submission.jobs.map(({ job_id, ref }) => ({ job_id, ref })), ...(note ? { note } : {}), ...guide };
        return { content: [{ type: 'text', text: `Done. ${note ? `${note} ` : ''}Reply with the markdown below exactly, plus at most one short sentence. Do not call Result, poll or generate again.\n\n${markdown}` }, ...(guide.prompting ? [{ type: 'text', text: JSON.stringify(guide) }] : [])], structuredContent: done };
      }
      return mcpJson({ ...submission, profile: summary, ...guide, message: `Submitted. ${note ? `${note} ` : ''}Share each link as [Watch <ref>](link). If Result supports run_in_background, start one Result per job with delivery=notification, wait_seconds=${maxResultWaitSeconds} and run_in_background=true, then reply; otherwise reply now. Never poll or resubmit.` });
    };
    const server = new McpServer({ name: 'Studio', version: '1.0.0' }, { instructions: scope === 'control' ? controlInstructions : instructions });
    if (scope === 'media' || scope === 'unlinked') {
      tool(server, 'Models', 'Browse Models', 'List ready profiles (id, label, kind, tier, summary). With profile_id, return its prompting guide, defaults, adjustable controls, compatible LoRAs, reference slots and native sizes. Not needed for ordinary requests.', { kind: z.enum(['all', 'image', 'video']).default('all'), tier: tier.optional(), profile_id: z.string().optional(), lora_query: z.string().max(200).optional().describe('Narrows a long LoRA list.') }, async ({ kind, tier: wanted, profile_id, lora_query }) => {
        let profiles = await media.profiles(kind, owner);
        if (profile_id === undefined) {
          if (wanted) profiles = profilesForTier(profiles, wanted);
          return mcpJson({ profiles: profiles.map(profile => ({ id: profile.id, label: profile.label, kind: profile.kind, tier: tierOf(profile), summary: summaryOf(profile) })) });
        }
        profiles = profiles.filter(profile => profile.id === profile_id);
        if (!profiles.length) throw new Error('Choose a ready profile from Models.');
        review(owner, profile_id);
        const [profile] = profiles;
        const infos = profile.options?.loras?.length && profile.capabilities?.lora !== false ? await media.loraInfos(owner) : {};
        const controls = mcpControls(profile);
        // Defaults only for adjustable controls: a fixed value is not something to choose.
        const defaults = Object.fromEntries(Object.entries({ ...profile.defaults, count: defaultGenerationCount }).filter(([key]) => controls[key] || ['frames', 'fps', 'duration'].includes(key)));
        const modes = profile.imageModes && Object.fromEntries(Object.entries(profile.imageModes).map(([mode, settings]) => {
          // The same merge Generate validates against when references select this mode.
          const merged = { ...profile, ...settings };
          return [mode, { controls: mcpControls(merged), ...(settings?.prompting ? { prompting: settings.prompting } : {}) }];
        }));
        const { loras, total } = mcpLoras(profile, infos, { query: lora_query });
        const detail = {
          ...Object.fromEntries(['id', 'label', 'kind', 'family', 'description', 'mediaInputs', 'aspectPolicy', 'aspectPresets', 'native'].filter(key => key in profile).map(key => [key, profile[key]])),
          tier: tierOf(profile), defaults, controls, ...(modes ? { imageModes: modes, imageModes_note: 'A mode applies when its media is supplied, such as reference with references.' } : {}),
          ...(controls.loras ? { loras, loras_total: total, ...(total > loras.length ? { loras_note: `Showing ${loras.length} of ${total}; narrow with lora_query.` } : {}) } : {}),
          prompting: prompting(profile, true)
        };
        return mcpJson({ profiles: [detail] });
      }, { readOnlyHint: true });
      tool(server, 'Generate', 'Generate Media', `Queue images or videos, at most four jobs per call. Pass kind and tier: Studio picks this account\u2019s default ready profile and its defaults; omit tier for the deployment default. A profile_id from Models overrides both; pass only the adjustable controls Models lists for it. Keep saved count and size unless asked. Waits briefly, then returns status done with markdown to reply with, or queued jobs to collect with Result. Never switches GPUs.`, {
        profile_id: z.string().min(1).optional(), kind: z.enum(['image', 'video']).optional().describe('Default image.'), tier: tier.optional(), prompts: z.array(z.string().trim().min(1)).min(1).max(4),
        loras: z.array(z.object({ name: z.string().min(1), strength: z.number().finite() }).strict()).max(32).optional(), reference_asset_ids: z.array(z.string().min(1)).max(16).optional(), reference_role: z.enum(['edit', 'reference']).optional(),
        width: z.number().int().positive().optional().describe('With height, requests native generation; 2K is a 2048-pixel long side.'), height: z.number().int().positive().optional(), count: z.number().int().min(1).max(4).optional(), steps: z.number().int().positive().optional(), seed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 4).optional(),
        wait_seconds: z.number().int().min(0).max(maxGenerateWaitSeconds).optional(), negative_prompt: z.string().optional(), cfg: z.number().finite().optional(), denoise: z.number().finite().optional(), sampler: z.string().optional(), scheduler: z.string().optional(), upscale_quality: z.enum(['fast', 'balanced', 'high']).optional(), face_detail: z.boolean().default(false)
      }, async ({ kind, tier: wanted, wait_seconds, ...args }, signal) => {
        // Without a profile_id Studio chooses, so there is no guide for the agent to have read first.
        const chosen = args.profile_id === undefined ? await media.choose(owner, { kind, tier: wanted, references: args.reference_asset_ids?.length || 0 }) : null;
        const profileId = chosen?.id ?? args.profile_id;
        const reviewed = reviewedGuides.get(guideKey(owner, profileId));
        // An unread guide accompanies the submission instead of costing a refused call and another round trip.
        const unread = !chosen && (reviewed === undefined || Date.now() - reviewed >= 3600000);
        const submission = await media.queue(owner, { ...args, profile_id: profileId }, refs);
        const profile = chosen || (await media.profiles('all', owner)).find(item => item.id === profileId);
        let guide = {};
        if (unread && profile) guide = { prompting: prompting(profile, true), guide_note: 'This profile\u2019s prompting guide was not read before submission; apply it to later prompts.' };
        if (chosen || unread) review(owner, profileId);
        return respond(submission, profile || { id: profileId }, wait_seconds, signal, guide);
      });
      tool(server, 'Status', 'Generation Status', 'Return a job\u2019s status and finished output links. Only when the user asks.', { ...job, wait_seconds: wait(20) }, async ({ job_id, wait_seconds }, signal) => {
        const id = resolve(job_id);
        const status = await media.job(owner, id, capWait(wait_seconds), { signal });
        const ref = media.refOf(owner, refs, id);
        return mcpJson({ job_id: id, ...(ref ? { ref } : {}), link: media.pageUrl(owner, id), ...media.summary(status), outputs: (status.outputs || []).flatMap((item, index) => mcpOutputPath(item.url) ? [{ output_index: index, url: media.url(owner, id, index) }] : []) });
      }, { readOnlyHint: true });
      tool(server, 'Result', 'Show Result', `Show a result: an image preview or video link. To collect a queued job, call once in the background with delivery=notification, wait_seconds=${maxResultWaitSeconds} and run_in_background=true, then wait for the host\u2019s notification; it carries the finished markdown, so reply with it and do not call Result again. Never poll.`, { ...output, delivery: z.enum(['notification', 'preview']).default('preview'), wait_seconds: wait(1800), detail: z.boolean().default(false).describe('Adds the JSON record to a notification.') }, ({ job_id, output_index, delivery, wait_seconds, detail }, signal) => media.result(owner, resolve(job_id), output_index, capWait(wait_seconds, delivery), delivery, { scope: refs, signal, detail }), { readOnlyHint: true });
      tool(server, 'Cancel', 'Cancel Generation', 'Cancel a job when the user asks.', job, async ({ job_id }) => {
        const id = resolve(job_id);
        media.own(owner, id);
        await media.job(owner, id);
        return mcpJson(await media.request('POST', `/api/jobs/${encodeURIComponent(id)}/cancel`, {}, owner));
      }, { destructiveHint: true });
      tool(server, 'Upload', 'Upload Reference', 'Upload a PNG, JPEG or WebP image (base64, at most 20 MB) as a reference asset for Generate.', { content_base64: z.string().min(1).max(28000000), filename: z.string().default('reference.png') }, async ({ content_base64, filename }) => mcpJson(await media.upload(owner, content_base64, filename)));
      tool(server, 'Reuse', 'Reuse Result', `Follow up on a finished result. With the result\u2019s own kind, run it again with the same profile and settings and a new seed; kind=video animates an image from its first frame. prompt replaces the original prompt. Replies like Generate. Without kind, return the image as a reference asset for Generate.`, {
        ...output, kind: z.enum(['image', 'video']).optional(), tier: tier.optional().describe('Only when animating.'),
        prompt: z.string().trim().min(1).optional(), count: z.number().int().min(1).max(4).default(1),
        wait_seconds: z.number().int().min(0).max(maxGenerateWaitSeconds).optional()
      }, async ({ job_id, output_index, kind, tier: wanted, prompt, count, wait_seconds }, signal) => {
        const id = resolve(job_id);
        if (!kind) {
          if (wanted || prompt) throw new Error('Pass kind with tier or prompt to generate from this result.');
          const result = await media.download(owner, id, output_index);
          if (!['image/png', 'image/jpeg', 'image/webp'].includes(result.mime)) throw new Error('Only images can be reused as references.');
          return mcpJson(await media.upload(owner, result.content.toString('base64'), `reference.${result.mime.split('/')[1]}`));
        }
        const item = await media.source(owner, id, output_index);
        const own = item.type === 'video' ? 'video' : 'image';
        if (kind !== own && own === 'video') throw new Error('A video result can only run again as a video.');
        if (kind === own && wanted) throw new Error('tier applies only when animating an image; call Generate for another tier.');
        const { profile, args } = kind === own ? await media.rerun(owner, item, { prompt, count }) : await media.animate(owner, id, output_index, item, { tier: wanted, prompt, count });
        review(owner, profile.id);
        return respond(await media.queue(owner, args, refs), profile, wait_seconds, signal);
      });
    } else {
      const request = async (method, route, body) => {
        try {
          const response = await fetchImpl(`${environment.CONTROL_URL.replace(/\/+$/, '')}/api/${route}`, { method, headers: { Authorization: `Bearer ${environment.CONTROL_API_KEY}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(15000) });
          if (![200, 202].includes(response.status)) throw new Error('refused');
          return mcpJson(await response.json());
        } catch { throw new Error('AI Control is unavailable or refused the request. Refresh its status and preview before retrying.'); }
      };
      tool(server, 'GPUStatus', 'GPU Status', 'Read GPU allocation and runtime health.', {}, () => request('GET', 'status'), { readOnlyHint: true });
      tool(server, 'Workloads', 'GPU Workloads', 'List workloads and placement rules for an explicitly requested allocation.', {}, () => request('GET', 'catalogue'), { readOnlyHint: true });
      tool(server, 'Preview', 'Preview GPU Allocation', 'Preview a COMPLETE GPU board without applying it; omitted workloads stop and an empty board stops all. Present the changes for approval; discard to cancel.', { allocation }, args => request('POST', 'board/plan', args), { readOnlyHint: true });
      tool(server, 'Apply', 'Apply GPU Allocation', 'Apply an explicitly requested allocation only after its Preview was presented and approved, with its exact signature. Active jobs may stop; never use it for media generation.', { allocation, signature: z.string().min(1), confirmed: z.boolean().default(false) }, ({ allocation, signature, confirmed }) => {
        if (!confirmed) throw new Error('Present the preview and obtain approval before applying this allocation.');
        return request('POST', 'board', { allocation, replace: true, signature });
      }, { destructiveHint: true });
      tool(server, 'Operation', 'GPU Operation', 'Read the job returned by Apply, without waiting.', { job_id: z.string().regex(/^[a-zA-Z0-9]{1,64}$/) }, ({ job_id }) => request('GET', `jobs/${job_id}`), { readOnlyHint: true });
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
      if (claims.page) {
        // Account mode reads as the signed owner through MCP's loopback credential; the studio rechecks that account's access.
        const html = await media.page(claims, accountMode ? internalCredential(claims.owner) : undefined);
        if (!html) throw new Error('Unavailable.');
        return res.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", 'Content-Type': 'text/html; charset=utf-8' }).send(html);
      }
      const result = accountMode
        ? await media.signedResult(claims.owner, claims.jobId, claims.index)
        : await media.download(claims.owner, claims.jobId, claims.index);
      res.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline', 'Content-Type': result.mime }).send(result.content);
    } catch { res.status(404).json({ error: 'The result link is invalid, unavailable or expired.' }); }
  });
  return true;
}
