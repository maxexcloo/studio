// SPDX-License-Identifier: AGPL-3.0-only
// Native port of the HEISS MCP media service; see mcp.LICENSE.
import crypto from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { defaultGenerationCount } from './generation-defaults.js';
import { readJsonFile, writeJsonFile } from './json-store.js';

const finished = new Set(['done', 'completed', 'succeeded']);
const terminal = new Set([...finished, 'failed', 'error', 'cancelled', 'canceled', 'missing']);
const hidden = (item) => ['privateVault', 'vaultLocked', 'promptProtected', 'promptEncrypted', 'hidden'].some(key => item?.[key]);
const safeId = (id) => encodeURIComponent(id);
const text = (value) => ({ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) });
export const mcpJson = (value) => ({ content: [text(value)], structuredContent: value });
export const mcpOwner = (key, user, token) => crypto.createHmac('sha256', key).update(user ? `forwarded:${user}` : `provider:${token}`).digest('hex');

export function mcpOutputPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return false;
  try {
    const url = new URL(value, 'http://localhost');
    return url.origin === 'http://localhost' && url.pathname === '/comfy/view' && Boolean(url.searchParams.get('filename')) && (!url.searchParams.has('type') || url.searchParams.get('type') === 'output');
  } catch { return false; }
}

export class McpMedia {
  constructor({ dataDir, baseUrl, publicUrl, signingKey, fetchImpl = fetch }) {
    this.baseUrl = baseUrl;
    this.publicBase = publicUrl;
    this.fetch = fetchImpl;
    this.file = path.join(dataDir, 'mcp-ownership.json');
    try { this.state = readJsonFile(this.file); } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('MCP ownership data could not be read. Restore it before enabling MCP.');
      this.state = { version: 1, signingKey: crypto.randomBytes(32).toString('base64url'), jobs: {}, assets: {} };
    }
    if (this.state.version !== 1 || !this.state.jobs || !this.state.assets || !this.state.signingKey) throw new Error('Invalid MCP ownership data.');
    this.key = signingKey || this.state.signingKey;
    this.save();
  }
  get publicUrl() { return typeof this.publicBase === 'function' ? this.publicBase() : this.publicBase; }
  save() { writeJsonFile(this.file, this.state, { mode: 0o600 }); }
  digest(value) { return crypto.createHmac('sha256', this.key).update(value).digest('hex'); }
  owner(user, token) { return mcpOwner(this.key, user, token); }
  own(owner, id, kind = 'jobs') {
    if (typeof id !== 'string' || !Object.hasOwn(this.state[kind], id) || !(kind === 'assets' ? [this.state[kind][id]].flat().includes(owner) : this.state[kind][id] === owner)) throw new Error(`Choose ${kind === 'jobs' ? 'a job' : 'a reference'} submitted by this account to this studio.`);
  }
  async response(method, route, body) {
    const base = new URL(typeof this.baseUrl === 'function' ? this.baseUrl() : this.baseUrl);
    if (!['127.0.0.1', '[::1]', 'localhost'].includes(base.hostname) || base.protocol !== 'http:') throw new Error('MCP requires the studio’s private HTTP loopback endpoint.');
    let response;
    try { response = await this.fetch(new URL(route, base), { method, headers: body instanceof FormData ? { 'X-Heiss': '1' } : { 'Content-Type': 'application/json', 'X-Heiss': '1' }, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(60000) }); } catch {
      const error = new Error('The studio connection was interrupted. Check the returned job before retrying.');
      error.submissionUncertain = true;
      throw error;
    }
    if (!response.ok) throw new Error(`HEISS refused the request (HTTP ${response.status}). Check the selected profile and studio availability.`);
    return response;
  }
  async request(method, route, body) {
    const response = await this.response(method, route, body);
    try { return await response.json(); } catch {
      const error = new Error('HEISS returned an invalid response. Check job status before retrying.');
      error.submissionUncertain = true;
      throw error;
    }
  }
  async profiles(kind = 'all') {
    // Concurrent submissions share discovery; do not queue repeated catalogue scans.
    this.profileRequest ||= this.request('GET', '/api/models?cached=1').finally(() => { this.profileRequest = null; });
    const models = await this.profileRequest;
    return (models.profiles || []).filter(profile => profile.ready !== false && (kind === 'all' || profile.kind === kind)).map(profile => ({ ...profile, ...profile.imageModes?.generate }));
  }
  async queue(owner, args) {
    const { profile_id, prompts, loras = [], reference_asset_ids = [], reference_role, count = defaultGenerationCount, seed, negative_prompt, cfg, denoise, sampler, scheduler, upscale_quality, face_detail = false } = args;
    let profile = (await this.profiles()).find(item => item.id === profile_id);
    if (!profile) throw new Error('Choose a ready profile from Models.');
    if (reference_asset_ids.length) profile = { ...profile, ...profile.imageModes?.reference };
    const caps = profile.capabilities || {};
    const controls = {};
    if (negative_prompt !== undefined) {
      if (negative_prompt && !caps.negativePrompt) throw new Error('This profile does not support negative prompts.');
      controls.negative = negative_prompt;
    }
    for (const [key, value] of Object.entries({ cfg, denoise })) if (value !== undefined) {
      const limits = profile.constraints?.[key] || {};
      if (!caps[key] || !Number.isFinite(value) || value < (limits.min ?? 0) || value > (limits.max ?? (key === 'denoise' ? 1 : 100))) throw new Error(`Choose supported ${key} within this profile’s constraints.`);
      controls[key] = value;
    }
    for (const [key, value] of Object.entries({ sampler, scheduler })) if (value !== undefined) {
      if (!caps[key] || !profile.options?.[`${key}s`]?.includes(value)) throw new Error(`Choose a supported ${key} from this profile’s options.`);
      controls[key] = value;
    }
    for (const adapter of loras) if (!profile.options?.loras?.includes(adapter.name)) throw new Error('Choose compatible LoRAs.');
    const slots = profile.mediaInputs || [];
    if (reference_asset_ids.length > slots.length || slots.some((slot, index) => slot.required && !reference_asset_ids[index])) throw new Error('Supply the references required by this profile.');
    for (const id of reference_asset_ids) this.own(owner, id, 'assets');
    if (reference_role !== undefined) {
      if (!reference_asset_ids.length || profile.aspectPolicy !== 'reference' || !String(profile.workflow || '').startsWith('family:')) throw new Error('Edit or Reference requires references on a supported built-in profile.');
      controls.referenceRole = reference_role;
    }
    if (upscale_quality) {
      if (profile.kind !== 'image') throw new Error('Smart upscale requires an image profile.');
      controls.autoUpscale = { quality: upscale_quality, faceDetail: face_detail };
    } else if (face_detail) throw new Error('Choose upscale_quality to enable face_detail.');
    const runs = count;
    if (prompts.length * runs > 4) throw new Error('Submit at most four jobs at a time.');
    const body = { ...profile.defaults, ...controls, kind: profile.kind, profileId: profile_id, model: profile.model, workflow: profile.workflow, count: 1, loras: loras.map(adapter => ({ ...adapter, enabled: true })), referenceAssets: reference_asset_ids.map((id, index) => ({ slot: slots[index].id, assetId: id })) };
    for (const key of ['width', 'height', 'steps']) if (args[key] !== undefined) body[key] = args[key];
    // Native 2K decodes in tiles, matching the browser’s generation path.
    if (profile.kind === 'image' && (Math.max(body.width, body.height) >= 2048 || body.width * body.height >= 2048 * 1152)) body.tiledDecode = true;
    const queued = [];
    for (const prompt of prompts) for (let variant = 0; variant < runs; variant++) {
      const id = crypto.randomUUID();
      try {
        // Persist the client id before dispatch: interrupted connections cannot lose job ownership.
        this.state.jobs[id] = owner;
        this.save();
        const result = await this.request('POST', '/api/generate', { ...body, clientJobId: id, prompt, seed: seed === undefined ? '' : String(seed + queued.length) });
        if (!result.jobId) throw new Error('HEISS did not return a job ID.');
        if (Object.hasOwn(this.state.jobs, result.jobId) && this.state.jobs[result.jobId] !== owner) throw new Error('HEISS returned a job owned by another account.');
        this.state.jobs[result.jobId] = owner;
        this.save();
        queued.push({ job_id: result.jobId, profile_id, count: body.count, variant_index: variant });
      } catch (error) {
        if (error.submissionUncertain) {
          queued.push({ job_id: id, profile_id, count: body.count, variant_index: variant, status: 'unknown' });
          return { status: 'partially_queued', jobs: queued, error: 'The last submission could not be acknowledged. Use Status with its returned job ID; do not resubmit.' };
        }
        if (queued.length) return { status: 'partially_queued', jobs: queued, error: 'Further submission failed; retain returned jobs before retrying.' };
        throw error;
      }
    }
    return { status: 'queued', jobs: queued };
  }
  async galleryJob(jobId) {
    const { items = [] } = await this.request('GET', `/api/gallery/jobs/${safeId(jobId)}`);
    const outputs = new Map();
    let kind;
    for (const item of items) if (item.jobId === jobId && item.status === 'done' && !hidden(item) && Number.isInteger(item.index) && item.index >= 0 && item.index < 1000 && mcpOutputPath(item.url)) {
      outputs.set(item.index, { url: item.url });
      kind = item.type;
    }
    return outputs.size ? { status: 'done', kind, outputs: Array.from({ length: Math.max(...outputs.keys()) + 1 }, (_, index) => outputs.get(index) || {}) } : { status: 'missing', outputs: [] };
  }
  async job(owner, jobId, seconds = 0) {
    this.own(owner, jobId);
    const deadline = Date.now() + seconds * 1000;
    while (true) {
      let job = await this.request('GET', `/api/jobs/${safeId(jobId)}`);
      if (hidden(job)) throw new Error('Hidden outputs are unavailable to MCP.');
      if (job.status === 'missing' || finished.has(job.status)) {
        // A subsequently hidden/deleted output is revoked even while its terminal job remains cached.
        const visible = await this.galleryJob(jobId);
        job = job.status === 'missing' ? visible : { ...job, outputs: visible.outputs, kind: visible.kind || job.kind };
      }
      if (terminal.has(job.status) || Date.now() >= deadline) return job;
      await new Promise(resolve => setTimeout(resolve, Math.min(2000, deadline - Date.now())));
    }
  }
  token(owner, jobId, index) {
    const payload = Buffer.from(JSON.stringify({ audience: this.publicUrl, owner, jobId, index, expires: Date.now() + 600000 })).toString('base64url');
    return `${payload}.${this.digest(payload)}`;
  }
  claims(token) {
    const [payload, signature, extra] = token.split('.');
    const expected = this.digest(payload || '');
    if (extra || !signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error('Invalid result link.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (claims.audience !== this.publicUrl || !Number.isFinite(claims.expires) || claims.expires <= Date.now() || !Number.isInteger(claims.index) || claims.index < 0) throw new Error('Invalid or expired result link.');
    this.own(claims.owner, claims.jobId);
    return claims;
  }
  url(owner, jobId, index) { return `${this.publicUrl}/mcp/results/${this.token(owner, jobId, index)}`; }
  available(job, index) {
    if (!finished.has(job.status) || hidden(job) || !Number.isInteger(index) || index < 0 || !mcpOutputPath(job.outputs?.[index]?.url)) throw new Error('Choose an available output from this completed job.');
    return job.outputs[index];
  }
  async download(owner, jobId, index) {
    const job = await this.job(owner, jobId);
    const output = this.available(job, index);
    return this.readOutput(output);
  }
  async readOutput(output) {
    const response = await this.response('GET', output.url);
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 128000000) throw new Error('Download large results directly from HEISS.');
      chunks.push(Buffer.from(chunk));
    }
    return { content: Buffer.concat(chunks), mime: response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream' };
  }
  async upload(owner, base64, filename = 'reference.png') {
    if (base64.length > 28000000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('Supply a base64 PNG, JPEG or WebP image of at most 20 MB.');
    const content = Buffer.from(base64, 'base64');
    if (!content.length || content.length > 20000000) throw new Error('Reference images must be at most 20 MB.');
    let metadata;
    try { metadata = await sharp(content, { limitInputPixels: 80000000 }).metadata(); } catch { throw new Error('Use a PNG, JPEG or WebP reference image.'); }
    if (!['png', 'jpeg', 'webp'].includes(metadata.format)) throw new Error('Use a PNG, JPEG or WebP reference image.');
    const form = new FormData();
    form.append('image', new Blob([content], { type: `image/${metadata.format}` }), path.basename(filename));
    const result = await this.request('POST', '/api/reference-assets/upload', form);
    if (!result.asset?.id || hidden(result.asset) || result.asset.privacyDomain === 'hidden') throw new Error('HEISS could not accept this reference image.');
    this.state.assets[result.asset.id] = [...new Set([...(this.state.assets[result.asset.id] ? [this.state.assets[result.asset.id]].flat() : []), owner])];
    this.save();
    return result;
  }
  async result(owner, jobId, index = 0, seconds = 0, delivery = 'preview') {
    const job = await this.job(owner, jobId, seconds);
    if (!finished.has(job.status)) return mcpJson({ job_id: jobId, ...this.summary(job) });
    const available = this.available(job, index);
    if (delivery === 'notification') return mcpJson({ job_id: jobId, output_index: index, status: 'done', kind: job.kind, message: 'This job is finished. Call Result once now with delivery=preview and wait_seconds=0 to show its image inline or view its video. Do not background the preview, poll or generate again.' });
    const url = this.url(owner, jobId, index);
    const link = { type: 'resource_link', uri: url, name: `${jobId}-${index}` };
    if (job.kind === 'video') return { content: [text(`[View Video](${url})`), link] };
    const output = await this.readOutput(available);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(output.mime)) return { content: [text(`[View Original](${url})`), { ...link, mimeType: output.mime }] };
    const preview = await sharp(output.content, { limitInputPixels: 80000000 }).rotate().resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#fff' }).jpeg({ quality: 80 }).toBuffer();
    return { content: [{ type: 'image', data: preview.toString('base64'), mimeType: 'image/jpeg' }, text({ job_id: jobId, output_index: index, status: 'done', message: 'Generation complete. Show the attached image inline. Its original opens in the browser; call it View Original, not Download. Reply briefly; do not generate or poll again unless requested.' }), text(`[View Original](${url})`), { ...link, mimeType: output.mime }] };
  }
  summary(job) { return Object.fromEntries(['status', 'kind', 'progress', 'error', 'failure'].filter(key => key in job).map(key => [key, job[key]])); }
}
