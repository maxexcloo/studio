// SPDX-License-Identifier: AGPL-3.0-only
// Native port of the HEISS MCP service; see mcp.LICENSE.
import crypto from 'node:crypto';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { defaultGenerationCount } from './generation-defaults.js';
import { hostAllowed } from './request-guard.js';
import { McpMedia, mcpJson, mcpOutputPath } from './mcp-media.js';
import { loadMcpPrompting } from './mcp-prompting.js';

const instructions = 'HEISS makes requested images and videos. Models lists profiles by kind; Models with a profile_id returns its prompting guide, defaults and reference slots. Keep explicit model choices, user intent and the saved count and size unless asked otherwise. Generate queues jobs and returns job IDs at once; never wait or poll in the foreground, and never resubmit. If Result supports run_in_background, start one Result per job with delivery=notification, wait_seconds=1800 and run_in_background=true, then reply immediately. When it reports done, call Result once with delivery=preview and wait_seconds=0, never in the background. Otherwise use Status or Result only when asked. Show images inline with a brief caption; label original links View Original, not Download; never paste raw URLs. Upload user images; Reuse owned ones. Never invent results. GPU allocation is manual: use AI Control tools only on explicit request, present Preview and get approval before Apply. Generation never changes allocation.';
const equal = (left, right) => Boolean(left && right && Buffer.byteLength(left) === Buffer.byteLength(right) && crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right)));
const wait = (max) => z.number().int().min(0).max(max).default(0);
const job = { job_id: z.string().min(1).max(200) };
const output = { ...job, output_index: z.number().int().min(0).max(999).default(0) };
const allocation = z.array(z.object({ profile: z.string().min(1), devices: z.array(z.string().min(1)).min(1) }).strict()).max(32);

/** Optional authenticated MCP on the studio's existing HTTP(S) server. */
export function registerMcpRoutes(app, { dataDir, baseUrl, environment = process.env, foregroundWaitSeconds = 20, fetchImpl = fetch, allowedHost = (req) => hostAllowed(req.headers.host), accountMode = false, authenticateAccountToken = () => null, authenticateGatewayIdentity = () => null, noteGatewayIdentity = () => {}, internalCredential = () => ({}), resolveSignedResult } = {}) {
  const mediaKey = environment.HEISS_MCP_API_KEY;
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
      // Gateway trust: the shared key vouches for the gateway; only an administrator's link maps its user to an account.
      if (!user) return res.status(403).json({ error: 'The gateway must forward its user identity.' });
      account = authenticateGatewayIdentity(user);
      if (!account) {
        noteGatewayIdentity(user);
        return res.status(403).json({ error: 'This chat user is not linked to a HEISS account yet. Ask a HEISS administrator to link it in Settings › Accounts & MCP.' });
      }
      scope = 'media';
      media.credentials.set(account.userId, internalCredential(account.userId));
    } else {
      account = authenticateAccountToken(token);
      if (account) {
        scope = 'media';
        media.credentials.set(account.userId, { Authorization: `Bearer ${token}` });
      }
    }
    if (!scope) return res.status(401).set('WWW-Authenticate', 'Bearer realm="HEISS MCP"').json({ error: 'A valid MCP bearer credential is required.' });
    req.mcpActor = { scope, owner: account?.userId || (scope === 'media' ? media.owner(user, token) : null) };
    next();
  };
  const tool = (server, name, title, description, inputSchema, action, annotations = {}) => server.registerTool(name, { title, description, inputSchema, annotations: { readOnlyHint: false, destructiveHint: false, ...annotations } }, async (args) => {
    try { return await action(args); } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error?.message || 'HEISS could not complete this request.' }] };
    }
  });
  const create = ({ scope, owner }) => {
    const server = new McpServer({ name: 'HEISS', version: '1.0.0' }, { instructions });
    if (scope === 'media') {
      tool(server, 'Models', 'Browse Models', 'List ready profiles by kind. With profile_id, return its prompting guide, defaults, capabilities, LoRAs, reference slots and native sizes. Explicit width and height request native generation; 2K means a 2048-pixel long side. imageModes.reference applies when references are supplied.', { kind: z.enum(['all', 'image', 'video']).default('all'), profile_id: z.string().optional() }, async ({ kind, profile_id }) => {
        let profiles = await media.profiles(kind, owner);
        if (profile_id !== undefined) {
          profiles = profiles.filter(profile => profile.id === profile_id);
          if (!profiles.length) throw new Error('Choose a ready profile from Models.');
        }
        if (profile_id !== undefined) review(owner, profile_id);
        const fields = profile_id === undefined ? ['id', 'label', 'kind'] : ['id', 'label', 'kind', 'family', 'description', 'capabilities', 'constraints', 'defaults', 'imageModes', 'mediaInputs', 'aspectPolicy', 'aspectPresets', 'native', 'options'];
        return mcpJson({ profiles: profiles.map(profile => ({ ...Object.fromEntries(fields.filter(key => key in profile).map(key => [key, profile[key]])), ...(profile_id === undefined ? {} : { defaults: { ...profile.defaults, count: defaultGenerationCount } }), prompting: prompting(profile, profile_id !== undefined) })) });
      }, { readOnlyHint: true });
      tool(server, 'Generate', 'Generate Media', 'Queue media and return job IDs at once. Keep saved defaults, count and size unless asked. At most four jobs per call. If this profile’s guide was not yet read, it is returned with the jobs; apply it to later prompts. Never wait, poll or resubmit. Never switches GPUs.', {
        profile_id: z.string().min(1), prompts: z.array(z.string().trim().min(1)).min(1).max(4),
        loras: z.array(z.object({ name: z.string().min(1), strength: z.number().finite() }).strict()).max(32).optional(), reference_asset_ids: z.array(z.string().min(1)).max(16).optional(), reference_role: z.enum(['edit', 'reference']).optional(),
        width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), count: z.number().int().min(1).max(4).optional(), steps: z.number().int().positive().optional(), seed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 4).optional(),
        wait_seconds: z.literal(0).default(0), negative_prompt: z.string().optional(), cfg: z.number().finite().optional(), denoise: z.number().finite().optional(), sampler: z.string().optional(), scheduler: z.string().optional(), upscale_quality: z.enum(['fast', 'balanced', 'high']).optional(), face_detail: z.boolean().default(false)
      }, async (args) => {
        const reviewed = reviewedGuides.get(guideKey(owner, args.profile_id));
        // An unread guide accompanies the submission instead of costing a refused call and another round trip.
        const unread = reviewed === undefined || Date.now() - reviewed >= 3600000;
        const submission = await media.queue(owner, args);
        let guide = {};
        if (unread) {
          const profile = (await media.profiles('all', owner)).find(item => item.id === args.profile_id);
          if (profile) guide = { prompting: prompting(profile, true), guide_note: 'This profile’s prompting guide was not read before submission; apply it to later prompts.' };
          review(owner, args.profile_id);
        }
        return mcpJson({ ...submission, ...guide, message: 'Submitted. If Result supports run_in_background, start one Result per job with delivery=notification, wait_seconds=1800 and run_in_background=true, then reply immediately. Otherwise reply now. Never poll, wait in the foreground or resubmit.' });
      });
      tool(server, 'Status', 'Generation Status', 'Return this account’s job status now, with signed links for finished outputs. Use Result for an inline preview. Wait only when asked, briefly.', { ...job, wait_seconds: wait(20) }, async ({ job_id, wait_seconds }) => {
        const status = await media.job(owner, job_id, capWait(wait_seconds));
        return mcpJson({ ...media.summary(status), outputs: (status.outputs || []).flatMap((item, index) => mcpOutputPath(item.url) ? [{ output_index: index, url: media.url(owner, job_id, index) }] : []) });
      }, { readOnlyHint: true });
      tool(server, 'Result', 'Show Result', 'Show this account’s result: a finished image preview or video link, immediately by default. For automatic completion, call once per job in the background with delivery=notification, wait_seconds=1800 and run_in_background=true; it returns text only. Then call delivery=preview with wait_seconds=0. Foreground waits are capped; never poll.', { ...output, delivery: z.enum(['notification', 'preview']).default('preview'), wait_seconds: wait(1800) }, ({ job_id, output_index, delivery, wait_seconds }) => media.result(owner, job_id, output_index, capWait(wait_seconds, delivery), delivery), { readOnlyHint: true });
      tool(server, 'Cancel', 'Cancel Generation', 'Cancel this account’s job when the user asks.', job, async ({ job_id }) => {
        media.own(owner, job_id);
        await media.job(owner, job_id);
        return mcpJson(await media.request('POST', `/api/jobs/${encodeURIComponent(job_id)}/cancel`, {}, owner));
      }, { destructiveHint: true });
      tool(server, 'Upload', 'Upload Reference', 'Upload a user’s PNG, JPEG or WebP image (base64, at most 20 MB) as a reference; pass its id to Generate.', { content_base64: z.string().min(1).max(28000000), filename: z.string().default('reference.png') }, async ({ content_base64, filename }) => mcpJson(await media.upload(owner, content_base64, filename)));
      tool(server, 'Reuse', 'Reuse Image', 'Use this account’s finished image as a reference without reattaching it. Hidden media cannot be reused.', output, async ({ job_id, output_index }) => {
        const result = await media.download(owner, job_id, output_index);
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(result.mime)) throw new Error('Only images can be reused as references.');
        return mcpJson(await media.upload(owner, result.content.toString('base64'), `reference.${result.mime.split('/')[1]}`));
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
      const result = accountMode
        ? await media.signedResult(claims.owner, claims.jobId, claims.index)
        : await media.download(claims.owner, claims.jobId, claims.index);
      res.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline', 'Content-Type': result.mime }).send(result.content);
    } catch { res.status(404).json({ error: 'The result link is invalid, unavailable or expired.' }); }
  });
  return true;
}
