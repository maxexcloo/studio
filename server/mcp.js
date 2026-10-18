// SPDX-License-Identifier: AGPL-3.0-only
// Native port of the HEISS MCP service; see mcp.LICENSE.
import crypto from 'node:crypto';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { hostAllowed } from './request-guard.js';
import { McpMedia, mcpJson, mcpOutputPath } from './mcp-media.js';
import { loadMcpPrompting } from './mcp-prompting.js';

const instructions = 'Use HEISS tools directly for requested images or videos. Discover Models by kind, then fetch the selected exact profile_id once for its prompting guidance, defaults and reference slots. Preserve explicit model choices and user intent. Generate takes prompts as a list of strings and returns job IDs immediately. Acknowledge the queued work and continue chatting; never loop over blocking waits or poll automatically. Use Status or Result for the exact job only when asked; never resubmit completed work. Generate one image at the saved dimensions unless the user explicitly requests more or another size. Present attached image previews briefly without reproducing image/download URLs. Upload user-supplied images, or Reuse an owned image for follow-ups. Never invent results or tool responses. GPU allocation is manual: only use separately authorised AI Control tools for an explicit control request, present Preview and obtain approval before Apply. Media generation never changes allocation.';
const equal = (left, right) => Boolean(left && right && Buffer.byteLength(left) === Buffer.byteLength(right) && crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right)));
const wait = (max) => z.number().int().min(0).max(max).default(0);
const job = { job_id: z.string().min(1).max(200) };
const output = { ...job, output_index: z.number().int().min(0).max(999).default(0) };
const allocation = z.array(z.object({ profile: z.string().min(1), devices: z.array(z.string().min(1)).min(1) }).strict()).max(32);

/** Optional authenticated MCP on the studio's existing HTTP(S) server. */
export function registerMcpRoutes(app, { dataDir, baseUrl, environment = process.env, fetchImpl = fetch, allowedHost = (req) => hostAllowed(req.headers.host) } = {}) {
  const mediaKey = environment.HEISS_MCP_API_KEY;
  const controlKey = environment.CONTROL_MCP_API_KEY;
  if (!mediaKey && !controlKey) return false;
  if (controlKey && (!environment.CONTROL_URL || !environment.CONTROL_API_KEY || equal(controlKey, mediaKey) || equal(controlKey, environment.CONTROL_API_KEY) || equal(mediaKey, environment.CONTROL_API_KEY))) throw new Error('AI Control requires separate MCP/media/upstream credentials and CONTROL_URL.');
  const publicUrl = environment.MCP_PUBLIC_URL?.replace(/\/+$/, '') || (typeof baseUrl === 'function' ? baseUrl() : baseUrl);
  const parsedPublic = new URL(publicUrl);
  if (!['http:', 'https:'].includes(parsedPublic.protocol) || parsedPublic.username || parsedPublic.password || parsedPublic.search || parsedPublic.hash) throw new Error('MCP_PUBLIC_URL must be an absolute HTTP(S) base URL without credentials, query or fragment.');
  const media = mediaKey ? new McpMedia({ dataDir, baseUrl, publicUrl: environment.MCP_PUBLIC_URL ? publicUrl : () => typeof baseUrl === 'function' ? baseUrl() : baseUrl, signingKey: environment.MCP_SIGNING_KEY, fetchImpl }) : null;
  const prompting = loadMcpPrompting(environment.MCP_PROMPTING_PATH);
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
    const scope = equal(token, mediaKey) ? 'media' : equal(token, controlKey) ? 'control' : '';
    if (!scope) return res.status(401).set('WWW-Authenticate', 'Bearer realm="HEISS MCP"').json({ error: 'A valid MCP bearer credential is required.' });
    const user = String(req.headers['x-bento-user-id'] || '');
    if (user.length > 256 || /[\x00-\x1f\x7f]/.test(user)) return res.status(400).json({ error: 'Invalid forwarded user identity.' });
    req.mcpActor = { scope, owner: scope === 'media' ? media.owner(user, token) : null };
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
      tool(server, 'Models', 'Browse Models', 'Discover ready profiles by kind. Supply exact profile_id for defaults, capabilities, prompting guidance, compatible LoRAs and reference slots. Fetch details before first use; imageModes.reference overrides text-only controls when references are supplied.', { kind: z.enum(['all', 'image', 'video']).default('all'), profile_id: z.string().optional() }, async ({ kind, profile_id }) => {
        let profiles = await media.profiles(kind);
        if (profile_id !== undefined) {
          profiles = profiles.filter(profile => profile.id === profile_id);
          if (!profiles.length) throw new Error('Choose a ready profile from Models.');
        }
        const fields = profile_id === undefined ? ['id', 'label', 'kind'] : ['id', 'label', 'kind', 'family', 'description', 'capabilities', 'constraints', 'defaults', 'imageModes', 'mediaInputs', 'aspectPolicy', 'aspectPresets', 'options'];
        return mcpJson({ profiles: profiles.map(profile => ({ ...Object.fromEntries(fields.filter(key => key in profile).map(key => [key, profile[key]])), ...(profile_id === undefined ? {} : { defaults: { ...profile.defaults, count: 1 } }), prompting: prompting(profile, profile_id !== undefined) })) });
      }, { readOnlyHint: true });
      tool(server, 'Generate', 'Generate Media', 'Queue requested media immediately; return job IDs without blocking chat. Fetch Models details first. Use one image at saved dimensions unless explicitly requested otherwise. Images use separate jobs for variants, at most four jobs per submission. Keep defaults unless requested. Set wait_seconds only for an explicit request to wait, never poll or resubmit for progress. Never switch GPUs.', {
        profile_id: z.string().min(1), prompts: z.array(z.string().trim().min(1)).min(1).max(4),
        loras: z.array(z.object({ name: z.string().min(1), strength: z.number().finite() }).strict()).max(32).optional(), reference_asset_ids: z.array(z.string().min(1)).max(16).optional(),
        width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), count: z.number().int().min(1).max(4).optional(), steps: z.number().int().positive().optional(), seed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 4).optional(),
        wait_seconds: wait(45), negative_prompt: z.string().optional(), cfg: z.number().finite().optional(), denoise: z.number().finite().optional(), sampler: z.string().optional(), scheduler: z.string().optional(), upscale_quality: z.enum(['fast', 'balanced', 'high']).optional(), face_detail: z.boolean().default(false)
      }, async (args) => {
        const deadline = Date.now() + args.wait_seconds * 1000;
        const submission = await media.queue(owner, args);
        const contents = [];
        if (args.wait_seconds) for (const queued of submission.jobs) {
          try {
            for (let index = 0; index < queued.count; index++) {
              const result = await media.result(owner, queued.job_id, index, Math.max(0, (deadline - Date.now()) / 1000));
              contents.push(...result.content);
              const status = await media.job(owner, queued.job_id);
              queued.status = status.status;
              if (status.kind === 'video' || status.status !== 'done') break;
            }
          } catch { queued.status = 'queued'; queued.retrieval_error = 'Submitted successfully. Use Result with this job ID; do not resubmit.'; }
        }
        return { ...mcpJson(submission), content: [...mcpJson(submission).content, ...contents] };
      });
      tool(server, 'Status', 'Generation Status', 'Return immediate status for this account’s job. Completed outputs have signed download links. Use Result for an inline preview. Wait only when explicitly asked, at most twenty seconds.', { ...job, wait_seconds: wait(20) }, async ({ job_id, wait_seconds }) => {
        const status = await media.job(owner, job_id, wait_seconds);
        return mcpJson({ ...media.summary(status), outputs: (status.outputs || []).flatMap((item, index) => mcpOutputPath(item.url) ? [{ output_index: index, url: media.url(owner, job_id, index) }] : []) });
      }, { readOnlyHint: true });
      tool(server, 'Result', 'Show Result', 'Show this account’s requested result. Return immediately by default; attach a finished image preview or video download. Never poll in a loop. Signed original download links expire after ten minutes and are revoked if an output is hidden or deleted.', { ...output, wait_seconds: wait(20) }, ({ job_id, output_index, wait_seconds }) => media.result(owner, job_id, output_index, wait_seconds), { readOnlyHint: true });
      tool(server, 'Cancel', 'Cancel Generation', 'Cancel only this account’s exact job when the user requests cancellation.', job, async ({ job_id }) => {
        media.own(owner, job_id);
        await media.job(owner, job_id);
        return mcpJson(await media.request('POST', `/api/jobs/${encodeURIComponent(job_id)}/cancel`, {}));
      }, { destructiveHint: true });
      tool(server, 'Upload', 'Upload Reference', 'Upload a user-supplied PNG, JPEG or WebP image as base64, at most 20 MB. The returned reference asset belongs to this account; supply its id to Generate.', { content_base64: z.string().min(1).max(28000000), filename: z.string().default('reference.png') }, async ({ content_base64, filename }) => mcpJson(await media.upload(owner, content_base64, filename)));
      tool(server, 'Reuse', 'Reuse Image', 'Reuse this account’s completed image as a reference without reattachment. Hidden media cannot be reused.', output, async ({ job_id, output_index }) => {
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
      tool(server, 'GPUStatus', 'AI Control Status', 'Read GPU allocation and runtime health. Requires a separate AI Control credential.', {}, () => request('GET', 'status'), { readOnlyHint: true });
      tool(server, 'Workloads', 'AI Control Catalogue', 'List supported workloads and placement rules before an explicitly requested allocation.', {}, () => request('GET', 'catalogue'), { readOnlyHint: true });
      tool(server, 'Preview', 'Preview GPU Allocation', 'Preview a COMPLETE GPU board without applying it. Omitted workloads stop; an empty board stops all workloads. Present the returned changes for approval. Cancel by discarding the preview.', { allocation }, args => request('POST', 'board/plan', args), { readOnlyHint: true });
      tool(server, 'Apply', 'Apply GPU Allocation', 'Apply only an explicitly requested complete allocation after presenting its preview and obtaining approval. Supply its exact signature. Active jobs may stop; never switch GPUs to satisfy media generation.', { allocation, signature: z.string().min(1), confirmed: z.boolean().default(false) }, ({ allocation, signature, confirmed }) => {
        if (!confirmed) throw new Error('Present the preview and obtain approval before applying this allocation.');
        return request('POST', 'board', { allocation, replace: true, signature });
      }, { destructiveHint: true });
      tool(server, 'Operation', 'AI Control Job', 'Read the control job returned by Apply, without waiting or starting another operation.', { job_id: z.string().regex(/^[a-zA-Z0-9]{1,64}$/) }, ({ job_id }) => request('GET', `jobs/${job_id}`), { readOnlyHint: true });
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
      const result = await media.download(claims.owner, claims.jobId, claims.index);
      res.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'attachment', 'Content-Type': result.mime }).send(result.content);
    } catch { res.status(404).json({ error: 'The result link is invalid, unavailable or expired.' }); }
  });
  return true;
}
