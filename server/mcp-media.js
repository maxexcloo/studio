// SPDX-License-Identifier: AGPL-3.0-only
// Native port of the HEISS MCP media service; see mcp.LICENSE.
import crypto from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { referenceImageSize } from './generation-defaults.js';
import { readJsonFile, writeJsonFile } from './json-store.js';
import { assertAdjustable, maxJobsPerCall, mcpControls, mcpGenerationCount, mcpSize, prepareLoras, resolveLoraName } from './mcp-controls.js';
import { compatibleLoras, loraCompatibility } from './lora-policy.js';
import { chooseProfile, isCloudProfile, localVideoUnavailable } from './mcp-tiers.js';
import { isLocalVideoProfile } from './comfy-backends.js';

/** What a failed job's own error says, as one sentence for the chat (a Radiance LoRA refusal reads as it was written). */
function failedReason(job) {
  const text = String(job?.failure?.summary || job?.error || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  return text ? (/[.!?)]$/.test(text) ? text : `${text}.`) : '';
}

const finished = new Set(['done', 'completed', 'succeeded']);
const terminal = new Set([...finished, 'failed', 'error', 'cancelled', 'canceled', 'missing']);
const safeId = (id) => encodeURIComponent(id);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
/** A conversation's result numbering; references look like "result 3", "r3", "#3" or "3". */
const referencePattern = /^\s*(?:result|r|#)?\s*#?\s*(\d{1,7})\s*$/i;
const maxReferenceScopes = 5000;
// Short result links: ten random base62 characters (about 59 bits), mapped server-side to an owner and output.
const shortAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const shortPattern = /^([A-Za-z0-9]{10})(\.jpg)?$/;
const previewSize = 1024;
// The All Results page and an "all" Result cover a conversation's most recent results.
const maxListedResults = 24;
const maxShownResults = 8;
export const maxResultWaitSeconds = 1500;
export { maxJobsPerCall };
/**
 * Refuses a call that would queue more than maxJobsPerCall jobs, naming the field, its range and how to split.
 * Schemas accept more than this on purpose: a client's own schema check would refuse with a generic message.
 */
export function assertJobCount(prompts = 1, count = 1) {
  const range = `1–${maxJobsPerCall}`;
  if (!Number.isInteger(count) || count < 1) throw new Error(`count must be a whole number from ${range}.`);
  if (prompts > maxJobsPerCall) throw new Error(`prompts has ${prompts} entries; one call takes ${range}, one job each. Split them into calls of at most ${maxJobsPerCall} prompts.`);
  if (prompts === 1 && count > maxJobsPerCall) throw new Error(`count ${count} is over the limit: count must be ${range} per call, each a separate job. For ${count} images, make ${Math.ceil(count / maxJobsPerCall)} calls of at most ${maxJobsPerCall}.`);
  if (prompts * count > maxJobsPerCall) {
    const fix = count > 1 ? `For ${prompts} different images, pass the ${prompts} prompts without count, or split them into calls whose prompts × count is at most ${maxJobsPerCall}.` : `Pass count ${maxJobsPerCall} or less.`;
    throw new Error(`count is images per prompt, so ${prompts} prompts × count ${count} would queue ${prompts * count} jobs; one call queues at most ${maxJobsPerCall}. ${fix}`);
  }
}
// A cloud provider that refused for authorisation or quota is skipped this long, so cloud video the user asks for doesn't queue doomed jobs.
export const cloudPauseMilliseconds = 10 * 60 * 1000;
export const cloudQuotaMessage = 'Cloud video unavailable (quota).';
const cloudRefusal = /\b(?:401|402|403|429)\b|quota|unauthori[sz]ed|forbidden|insufficient|credit|billing|rate.?limit|exhausted/i;
const isCloudVideo = (profile) => profile?.kind === 'video' && !isLocalVideoProfile(profile);
// Request records behind each MCP job, for Reuse tweaks and the result page; the oldest go first.
const maxPromptRecords = 5000;
const aborted = (signal) => {
  const error = new Error('The wait ended because the request was cancelled. The generation continues; collect it later with Result.');
  error.aborted = true;
  return error;
};
const pause = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(aborted(signal));
  const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, milliseconds);
  const stop = () => { clearTimeout(timer); reject(aborted(signal)); };
  signal?.addEventListener('abort', stop, { once: true });
});
const text = (value) => ({ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) });
export const mcpJson = (value) => ({ content: [text(value)], structuredContent: value });
export const mcpOwner = (key, user, token) => crypto.createHmac('sha256', key).update(user ? `forwarded:${user}` : `provider:${token}`).digest('hex');

export function mcpOutputPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return false;
  try {
    const url = new URL(value, 'http://localhost');
    // ComfyUI outputs, or HEISS-owned media (media-paths.js), which the studio serves itself.
    return url.origin === 'http://localhost' && url.pathname === '/comfy/view' && Boolean(url.searchParams.get('filename')) && (!url.searchParams.has('type') || ['output', 'media'].includes(url.searchParams.get('type')));
  } catch { return false; }
}

export class McpMedia {
  constructor({ dataDir, baseUrl, publicUrl, signingKey, fetchImpl = fetch, resolveSignedResult, profileTtl = 60000 }) {
    this.profileTtl = profileTtl;
    this.baseUrl = baseUrl;
    this.publicBase = publicUrl;
    this.fetch = fetchImpl;
    this.resolveSignedResult = resolveSignedResult;
    this.credentials = new Map();
    this.profileRequests = new Map();
    this.file = path.join(dataDir, 'mcp-ownership.json');
    try { this.state = readJsonFile(this.file); } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('MCP ownership data could not be read. Restore it before enabling MCP.');
      this.state = { version: 1, signingKey: crypto.randomBytes(32).toString('base64url'), jobs: {}, assets: {} };
    }
    if (this.state.version !== 1 || !this.state.jobs || !this.state.assets || !this.state.signingKey) throw new Error('Invalid MCP ownership data.');
    // Result numbering is additive; files written before it simply start without references.
    if (!this.state.refs || typeof this.state.refs !== 'object' || Array.isArray(this.state.refs)) this.state.refs = {};
    if (!this.state.links || typeof this.state.links !== 'object' || Array.isArray(this.state.links)) this.state.links = {};
    if (!this.state.prompts || typeof this.state.prompts !== 'object' || Array.isArray(this.state.prompts)) this.state.prompts = {};
    // Recent cloud video jobs by id: their owner, submission time and whether they ended.
    this.cloudJobs = new Map();
    this.cloudUnavailableUntil = 0;
    this.linkIds = new Map(Object.entries(this.state.links).map(([id, link]) => [link.all ? this.linkKey(link.audience, link.owner, `refs:${link.scope}`, 'all') : this.linkKey(link.audience, link.owner, link.jobId, link.index), id]));
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
  async response(method, route, body, owner = "", { credential: override, signal } = {}) {
    const base = new URL(typeof this.baseUrl === 'function' ? this.baseUrl() : this.baseUrl);
    if (!['127.0.0.1', '[::1]', 'localhost'].includes(base.hostname) || base.protocol !== 'http:') throw new Error('MCP requires the studio’s private HTTP loopback endpoint.');
    let response;
    const credential = override || this.credentials.get(owner);
    // An account's credential is a header set: its personal bearer, or MCP's internal loopback credential.
    const headers = { ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), 'X-Heiss': '1', ...(credential || {}) };
    try { response = await this.fetch(new URL(route, base), { method, headers, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }), redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) }); } catch {
      if (signal?.aborted) throw aborted(signal);
      const error = new Error('The studio connection was interrupted. Check the returned job before retrying.');
      error.submissionUncertain = true;
      throw error;
    }
    if (!response.ok) {
      // The studio's own validation message names the problem (a LoRA policy, a reference); keep it short.
      let reason = '';
      if ([400, 403, 409, 422, 429].includes(response.status)) try { const answer = await response.json(); reason = typeof answer?.error === 'string' ? answer.error.replace(/\s+/g, ' ').trim().slice(0, 400) : ''; } catch { /* No JSON reason. */ }
      throw new Error(reason ? `Studio refused the request: ${reason}` : `Studio refused the request (HTTP ${response.status}). Check the selected profile and studio availability.`);
    }
    return response;
  }
  async request(method, route, body, owner = "", options = {}) {
    const response = await this.response(method, route, body, owner, options);
    try { return await response.json(); } catch {
      const error = new Error('Studio returned an invalid response. Check job status before retrying.');
      error.submissionUncertain = true;
      throw error;
    }
  }
  /** Forget every cached catalogue when the studio's model list changes. */
  invalidateProfiles() {
    this.profileGeneration = (this.profileGeneration || 0) + 1;
    this.profileCache?.clear();
  }
  async profiles(kind = 'all', owner = "") {
    const models = await this.catalogue(owner);
    return (models.profiles || []).filter(profile => profile.ready !== false && (kind === 'all' || profile.kind === kind)).map(profile => ({ ...profile, ...profile.imageModes?.generate }));
  }
  /**
   * The profile Generate uses for a kind and optional tier when no profile_id is given; access rules apply upstream.
   * Cloud (Grok) profiles join only when the user asked for the cloud (`cloud`). While the local video worker is
   * unavailable, video is refused with what to tell the user, never sent to the cloud by itself.
   */
  async choose(owner, { kind = 'image', tier, references = 0, firstFrame = false, loras = [], cloud = false } = {}) {
    const models = await this.catalogue(owner);
    let profiles = await this.profiles(kind, owner);
    if (!cloud) {
      profiles = profiles.filter(profile => !isCloudProfile(profile));
      if (kind === 'video' && models.backends?.video?.available === false) throw new Error(localVideoUnavailable);
    }
    if (loras.length) {
      // Named LoRAs narrow the choice to profiles that can use every one of them.
      const infos = await this.loraInfos(owner);
      const usable = (profile) => profile.capabilities?.lora !== false && loras.every(({ name }) => {
        const file = resolveLoraName(profile, name);
        return file && !['acceleration', 'supporting'].includes(infos[file]?.role) && loraCompatibility(infos[file], profile) !== 'other';
      });
      profiles = profiles.filter(usable);
      if (!profiles.length) throw new Error(`No ready ${kind} profile can use ${loras.map(({ name }) => name).join(', ')}. Call Models with lora_query to look it up.`);
    }
    const defaultId = models.defaults?.[kind === 'video' ? 'videoModel' : 'imageModel'];
    return chooseProfile(profiles, { kind, tier, references, firstFrame, defaultId });
  }
  async catalogue(owner = "") {
    // Each owner's catalogue is cached briefly and separately: accounts may see different profiles and LoRAs.
    this.profileRequests ||= new Map();
    this.profileCache ||= new Map();
    const cached = this.profileCache.get(owner);
    let models = cached && Date.now() - cached.at < (this.profileTtl ?? 60000) ? cached.models : null;
    if (!models) {
      // Concurrent submissions share discovery; do not queue repeated catalogue scans.
      if (!this.profileRequests.has(owner)) {
        const generation = this.profileGeneration || 0;
        const pending = this.request('GET', '/api/models?cached=1', undefined, owner).then(result => {
          // A scan that overlapped a model-list change is used once but not cached.
          if ((this.profileGeneration || 0) === generation) {
            if (this.profileCache.size >= 4096) this.profileCache.delete(this.profileCache.keys().next().value);
            this.profileCache.set(owner, { at: Date.now(), models: result });
          }
          return result;
        }).finally(() => this.profileRequests.delete(owner));
        this.profileRequests.set(owner, pending);
      }
      models = await this.profileRequests.get(owner);
    }
    return models;
  }
  /** The studio LoRA picker's metadata for this account, briefly cached; access rules apply upstream. */
  async loraInfos(owner = "") {
    this.loraCache ||= new Map();
    const cached = this.loraCache.get(owner);
    if (cached && Date.now() - cached.at < 60000) return cached.loras;
    try {
      const { loras = {} } = await this.request('GET', '/api/loras/info', undefined, owner);
      if (this.loraCache.size >= 256) this.loraCache.delete(this.loraCache.keys().next().value);
      this.loraCache.set(owner, { at: Date.now(), loras });
      return loras;
    } catch { return {}; }
  }
  /** Minutes left while the cloud video provider is known to refuse, otherwise 0. */
  cloudPause() {
    const left = this.cloudUnavailableUntil - Date.now();
    return left > 0 ? Math.ceil(left / 60000) : 0;
  }
  /** A cloud refusal for authorisation or quota pauses cloud video; returns whether this was one. */
  noteCloudRefusal(text) {
    if (!cloudRefusal.test(String(text || ''))) return false;
    this.cloudUnavailableUntil = Date.now() + cloudPauseMilliseconds;
    return true;
  }
  /** Reads the few most recent unfinished cloud jobs, so a refusal is known before another cloud job queues. */
  async checkCloudJobs() {
    if (this.cloudPause()) return;
    const recent = [...this.cloudJobs].filter(([, entry]) => !entry.ended && Date.now() - entry.at < 30 * 60 * 1000).slice(-4);
    await Promise.all(recent.map(async ([jobId, entry]) => {
      try { if (terminal.has((await this.job(entry.owner, jobId)).status)) entry.ended = true; } catch { /* Unreadable now; the job itself is unaffected. */ }
    }));
  }
  /** The request behind an MCP job and the prompt it ran, when Studio recorded them. */
  promptRecord(jobId) {
    return Object.hasOwn(this.state.prompts, jobId) ? this.state.prompts[jobId] : null;
  }
  /**
   * Queues one job per prompt and count. `record` keeps the user's request and changes beside each job,
   * so a later tweak re-expands the original request instead of the written prompt.
   */
  async queue(owner, args, scope = '', record = {}) {
    const { profile_id, prompts, loras = [], reference_asset_ids = [], reference_role, count = mcpGenerationCount, seed, negative_prompt, cfg, denoise, sampler, scheduler, upscale_quality, face_detail = false } = args;
    let profile = (await this.profiles('all', owner)).find(item => item.id === profile_id);
    if (!profile) throw new Error('Choose a ready profile from Models.');
    const cloud = isCloudVideo(profile);
    if (cloud) await this.checkCloudJobs();
    if (cloud && this.cloudPause()) throw new Error(`${cloudQuotaMessage} The cloud provider refused recent jobs, so Studio queues no cloud video for about ${this.cloudPause()} more minute${this.cloudPause() > 1 ? 's' : ''}. Tell the user video needs the local video worker until the quota returns.`);
    if (reference_asset_ids.length) profile = { ...profile, ...profile.imageModes?.reference };
    // Fixed controls are refused by name, with the adjustable alternatives, instead of being dropped;
    // a supplied value equal to a fixed one passes unchanged.
    const adjustable = assertAdjustable(profile, args);
    const controls = {};
    if (negative_prompt !== undefined && adjustable.negative_prompt) controls.negative = negative_prompt;
    for (const [key, value] of Object.entries({ cfg, denoise, sampler, scheduler })) if (value !== undefined) controls[key] = value;
    // Names resolve to the profile's files and take their recommended strength unless one is given.
    const stack = loras.length ? prepareLoras(profile, await this.loraInfos(owner), loras) : [];
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
    assertJobCount(prompts.length, runs);
    const body = { ...profile.defaults, ...controls, kind: profile.kind, profileId: profile_id, model: profile.model, workflow: profile.workflow, count: 1, loras: stack.map(adapter => ({ ...adapter, enabled: true })), referenceAssets: reference_asset_ids.map((id, index) => ({ slot: slots[index].id, assetId: id })) };
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
        const result = await this.request('POST', '/api/generate', { ...body, clientJobId: id, prompt, seed: seed === undefined ? '' : String(seed + queued.length) }, owner);
        if (!result.jobId) throw new Error('Studio did not return a job ID.');
        if (Object.hasOwn(this.state.jobs, result.jobId) && this.state.jobs[result.jobId] !== owner) throw new Error('Studio returned a job owned by another account.');
        this.state.jobs[result.jobId] = owner;
        if (cloud) {
          if (this.cloudJobs.size >= 256) this.cloudJobs.delete(this.cloudJobs.keys().next().value);
          this.cloudJobs.set(result.jobId, { owner, at: Date.now(), ended: false });
        }
        this.recordPrompt(result.jobId, { prompt, ...(record.request ? { request: record.request } : {}), ...(record.changes?.length ? { changes: record.changes } : {}) });
        this.save();
        queued.push({ job_id: result.jobId, ...this.handle(owner, scope, result.jobId), prompt });
      } catch (error) {
        if (error.submissionUncertain) {
          queued.push({ job_id: id, ...this.handle(owner, scope, id), status: 'unknown', prompt });
          return { status: 'partially_queued', jobs: queued, error: 'The last submission could not be acknowledged. Use Status with its returned job ID; do not resubmit.' };
        }
        if (cloud && this.noteCloudRefusal(error.message)) error.message = `${cloudQuotaMessage} ${error.message}`;
        // The studio's reason (such as its outstanding-job limit) tells the agent why the rest did not queue.
        if (queued.length) return { status: 'partially_queued', jobs: queued, error: `Further submission failed; retain returned jobs before retrying. ${error.message}` };
        throw error;
      }
    }
    return { status: 'queued', jobs: queued };
  }
  recordPrompt(jobId, record) {
    const keys = Object.keys(this.state.prompts);
    if (keys.length >= maxPromptRecords) delete this.state.prompts[keys[0]];
    this.state.prompts[jobId] = record;
  }
  async galleryJob(jobId, owner = "", options = {}) {
    // Settings name the profile for the result's header.
    const { items = [] } = await this.request('GET', `/api/gallery/jobs/${safeId(jobId)}?settings=1`, undefined, owner, options);
    const outputs = new Map();
    let kind, profileId;
    for (const item of items) if (item.jobId === jobId && item.status === 'done' && Number.isInteger(item.index) && item.index >= 0 && item.index < 1000 && mcpOutputPath(item.url)) {
      outputs.set(item.index, { url: item.url });
      kind = item.type;
      profileId ||= item.settings?.profileId;
    }
    return outputs.size ? { status: 'done', kind, profileId, outputs: Array.from({ length: Math.max(...outputs.keys()) + 1 }, (_, index) => outputs.get(index) || {}) } : { status: 'missing', outputs: [] };
  }
  /** Scope of a conversation's result numbers: the owner, narrowed by the client's conversation when it sends one. */
  referenceScope(owner, conversation = '') {
    return this.digest(`refs\n${owner}\n${conversation}`).slice(0, 32);
  }
  /** The next "result N" in this scope; numbers are never reused. */
  reference(owner, scope, jobId) {
    const key = scope || this.referenceScope(owner);
    let entry = this.state.refs[key];
    if (!entry) {
      const keys = Object.keys(this.state.refs);
      if (keys.length >= maxReferenceScopes) delete this.state.refs[keys.reduce((oldest, item) => (this.state.refs[item].at || 0) < (this.state.refs[oldest].at || 0) ? item : oldest)];
      entry = this.state.refs[key] = { next: 1, jobs: {} };
    }
    const existing = Object.entries(entry.jobs).find(([, id]) => id === jobId)?.[0];
    if (existing) return Number(existing);
    const number = entry.next++;
    entry.jobs[number] = jobId;
    entry.at = Date.now();
    this.save();
    return number;
  }
  /** A job's short reference and its signed watch page, returned with the submission. */
  handle(owner, scope, jobId) {
    return { ref: `result ${this.reference(owner, scope, jobId)}`, link: this.pageUrl(owner, jobId) };
  }
  /** Accepts a job ID or a reference such as "result 3" from this conversation. */
  resolve(owner, scope, value) {
    // A result link (or its id) from an earlier reply names its job, when it belongs to this account.
    const short = /^(?:https?:\/\/\S+\/mcp\/results\/)?([A-Za-z0-9]{10})(?:\.jpg)?$/.exec(String(value || '').trim())?.[1];
    const linked = short && Object.hasOwn(this.state.links, short) ? this.state.links[short] : null;
    if (linked?.jobId && linked.owner === owner) return linked.jobId;
    const match = referencePattern.exec(String(value || ''));
    if (!match) return value;
    const jobId = this.state.refs[scope || this.referenceScope(owner)]?.jobs?.[Number(match[1])];
    if (!jobId) throw new Error(`There is no result ${Number(match[1])} in this conversation. Use the job_id or a ref returned by Generate.`);
    return jobId;
  }
  refOf(owner, scope, jobId) {
    const entry = this.state.refs[scope || this.referenceScope(owner)];
    const number = entry && Object.entries(entry.jobs).find(([, id]) => id === jobId)?.[0];
    return number ? `result ${number}` : undefined;
  }
  async job(owner, jobId, seconds = 0, { signal, credential, interval = 2000 } = {}) {
    this.own(owner, jobId);
    const deadline = Date.now() + seconds * 1000;
    while (true) {
      if (signal?.aborted) throw aborted(signal);
      let job = await this.request('GET', `/api/jobs/${safeId(jobId)}`, undefined, owner, { signal, credential });
      if (job.status === 'missing' || finished.has(job.status)) {
        // A subsequently deleted output is revoked even while its terminal job remains cached.
        const visible = await this.galleryJob(jobId, owner, { signal, credential });
        job = job.status === 'missing' ? visible : { ...job, outputs: visible.outputs, kind: visible.kind || job.kind, profileId: visible.profileId };
      }
      // A cloud job refused for authorisation or quota reads as such, and pauses further cloud video.
      // Each failed job counts once, so reading it again later never extends the pause.
      const cloud = this.cloudJobs.get(jobId);
      if (cloud && ['failed', 'error'].includes(job.status)) {
        cloud.ended = true;
        cloud.refused ??= this.noteCloudRefusal(`${job.error || ''} ${JSON.stringify(job.failure || '')}`);
        if (cloud.refused) job = { ...job, error: cloudQuotaMessage, cloudQuota: true };
      }
      if (terminal.has(job.status) || Date.now() >= deadline) return job;
      // A client Stop or disconnect ends only this wait; the generation itself keeps running.
      await pause(Math.min(interval, deadline - Date.now()), signal);
    }
  }
  /** Result links are sealed (AES-256-GCM), so a shared link reveals no account or job ID. */
  sealingKey() {
    return crypto.hkdfSync('sha256', Buffer.from(String(this.key)), Buffer.alloc(0), Buffer.from('heiss-mcp-result-link-v2'), 32);
  }
  token(owner, jobId, index) {
    // Links do not expire; every request rechecks ownership and that the output still exists.
    return this.seal('v2', { audience: this.publicUrl, owner, jobId, index });
  }
  seal(prefix, claims) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(this.sealingKey()), iv, { authTagLength: 16 });
    const sealed = Buffer.concat([cipher.update(JSON.stringify(claims)), cipher.final()]);
    return `${prefix}.${iv.toString('base64url')}.${sealed.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
  }
  linkKey(audience, owner, jobId, index) { return JSON.stringify([audience, owner, jobId, index ?? 'page']); }
  /**
   * A short opaque link id for an output (or a job's watch page), reused for the same output.
   * Like a sealed link it is bound to this public URL, and each request rechecks ownership and availability.
   */
  shortId(owner, jobId, index) {
    const audience = this.publicUrl;
    const key = this.linkKey(audience, owner, jobId, index);
    const existing = this.linkIds.get(key);
    if (existing) return existing;
    let id;
    do id = Array.from({ length: 10 }, () => shortAlphabet[crypto.randomInt(shortAlphabet.length)]).join(''); while (Object.hasOwn(this.state.links, id));
    this.state.links[id] = { audience, owner, jobId, ...(index === undefined ? { page: true } : { index }) };
    this.linkIds.set(key, id);
    this.save();
    return id;
  }
  /** A job's watch page: shows progress until done, then its outputs, without the chat. */
  pageUrl(owner, jobId) { return `${this.publicUrl}/mcp/results/${this.shortId(owner, jobId)}`; }
  /** The All Results page of a conversation's result numbers (the account's without a conversation), reused per scope. */
  allUrl(owner, scope) {
    const key = scope || this.referenceScope(owner);
    const audience = this.publicUrl;
    const linkKey = this.linkKey(audience, owner, `refs:${key}`, 'all');
    let id = this.linkIds.get(linkKey);
    if (!id) {
      do id = Array.from({ length: 10 }, () => shortAlphabet[crypto.randomInt(shortAlphabet.length)]).join(''); while (Object.hasOwn(this.state.links, id));
      this.state.links[id] = { audience, owner, scope: key, all: true };
      this.linkIds.set(linkKey, id);
      this.save();
    }
    return `${this.publicUrl}/mcp/results/${id}`;
  }
  /** A finished image's chat-sized JPEG preview. */
  previewUrl(owner, jobId, index) { return `${this.publicUrl}/mcp/results/${this.shortId(owner, jobId, index)}.jpg`; }
  claims(token) {
    const short = shortPattern.exec(String(token || ''));
    if (short) {
      const link = Object.hasOwn(this.state.links, short[1]) ? this.state.links[short[1]] : null;
      if (!link || link.audience !== this.publicUrl || (short[2] && (link.page || link.all))) throw new Error('Invalid result link.');
      if (link.all) return { owner: link.owner, scope: link.scope, all: true };
      this.own(link.owner, link.jobId);
      return { owner: link.owner, jobId: link.jobId, ...(link.page ? { page: true } : { index: link.index }), ...(short[2] ? { preview: true } : {}) };
    }
    const parts = String(token || '').split('.');
    let claims;
    if (parts[0] === 'v2' || parts[0] === 'p2') {
      const [, iv, sealed, tag, extra] = parts;
      // Canonical base64url only: an altered character must never decode to the same bytes.
      const canonical = (part) => Buffer.from(part, 'base64url').toString('base64url') === part;
      if (extra !== undefined || !iv || !sealed || !tag || ![iv, sealed, tag].every(canonical)) throw new Error('Invalid result link.');
      try {
        // A full 16-byte tag only: older Node accepts truncated tags, which are easier to forge.
        const tagBytes = Buffer.from(tag, 'base64url');
        if (tagBytes.length !== 16) throw new Error('short tag');
        const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(this.sealingKey()), Buffer.from(iv, 'base64url'), { authTagLength: 16 });
        decipher.setAuthTag(tagBytes);
        claims = JSON.parse(Buffer.concat([decipher.update(Buffer.from(sealed, 'base64url')), decipher.final()]).toString());
      } catch { throw new Error('Invalid result link.'); }
    } else {
      // Links issued before sealing: a readable payload with its signature, and any expiry it carried.
      const [payload, signature, extra] = parts;
      const expected = this.digest(payload || '');
      if (extra || !signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error('Invalid result link.');
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (claims.expires !== undefined && (!Number.isFinite(claims.expires) || claims.expires <= Date.now())) throw new Error('Invalid or expired result link.');
    }
    // A watch page (p2) carries no output index; an output link (v2) always does. Neither can stand in for the other.
    const page = parts[0] === 'p2';
    if (claims.audience !== this.publicUrl || page !== (claims.page === true) || (!page && (!Number.isInteger(claims.index) || claims.index < 0))) throw new Error('Invalid result link.');
    this.own(claims.owner, claims.jobId);
    return claims;
  }
  url(owner, jobId, index) { return `${this.publicUrl}/mcp/results/${this.shortId(owner, jobId, index)}`; }
  available(job, index) {
    if (!finished.has(job.status) || !Number.isInteger(index) || index < 0 || !mcpOutputPath(job.outputs?.[index]?.url)) throw new Error('Choose an available output from this completed job.');
    return job.outputs[index];
  }
  async download(owner, jobId, index, options = {}) {
    const job = await this.job(owner, jobId, 0, options);
    const output = this.available(job, index);
    return this.readOutput(output, owner);
  }
  /** A finished, visible output's gallery record with its prompt and settings, for Reuse to run it again or animate it. */
  async source(owner, jobId, index) {
    this.available(await this.job(owner, jobId), index);
    const { items = [] } = await this.request('GET', `/api/gallery/jobs/${safeId(jobId)}?settings=1`, undefined, owner);
    const item = items.find(entry => entry.jobId === jobId && entry.index === index && entry.status === 'done');
    if (!item?.settings?.profileId || !item.prompt) throw new Error('This result has no recorded profile or prompt to reuse. Call Generate instead.');
    return item;
  }
  /** Generate arguments that run a finished output again with its profile and settings; the seed is new. */
  async rerun(owner, item, { prompt, count = 1 } = {}) {
    const settings = item.settings;
    const base = (await this.profiles(item.type === 'video' ? 'video' : 'image', owner)).find(profile => profile.id === settings.profileId);
    if (!base) throw new Error('The profile behind this result is no longer available to this account. Call Generate instead.');
    const references = (settings.referenceAssets || []).map(asset => asset?.assetId).filter(Boolean);
    const profile = references.length ? { ...base, ...base.imageModes?.reference } : base;
    const controls = mcpControls(profile);
    const args = { profile_id: base.id, prompts: [prompt || item.prompt], count, ...(references.length ? { reference_asset_ids: references } : {}) };
    if (settings.referenceRole && controls.reference_role) args.reference_role = settings.referenceRole;
    // Only what this run changed from the profile's defaults, and only what MCP may adjust.
    const recorded = { width: item.width, height: item.height, steps: settings.steps, cfg: settings.cfg, denoise: settings.denoise, sampler: settings.sampler, scheduler: settings.scheduler };
    for (const [key, value] of Object.entries(recorded)) if (controls[key] && value !== undefined && value !== '' && value !== 0 && value !== profile.defaults?.[key]) args[key] = value;
    if (item.negative && controls.negative_prompt) args.negative_prompt = item.negative;
    const saved = controls.loras ? (settings.loras || []).filter(lora => lora?.enabled !== false && profile.options?.loras?.includes(lora.name)).map(({ name, strength }) => ({ name, strength })) : [];
    // A LoRA for another model family would be refused on submit, so a rerun leaves it out and says so.
    const { loras, droppedNames } = saved.length ? compatibleLoras(saved, await this.loraInfos(owner), profile) : { loras: [], droppedNames: [] };
    if (loras.length) args.loras = loras;
    return { profile: base, args, ...(droppedNames.length ? { droppedLoras: droppedNames } : {}) };
  }
  /** Generate arguments that run a finished output on another profile of its kind, at its proportions and with its references. */
  retarget(item, profile, { count = 1 } = {}) {
    const references = (item.settings?.referenceAssets || []).map(asset => asset?.assetId).filter(Boolean);
    const args = { profile_id: profile.id, prompts: [item.prompt], count, ...(references.length ? { reference_asset_ids: references } : {}) };
    const controls = mcpControls(references.length ? { ...profile, ...profile.imageModes?.reference } : profile);
    if (controls.width && controls.height && item.width > 0 && item.height > 0) Object.assign(args, mcpSize(profile, { aspect: `${item.width}:${item.height}` }));
    return { profile, args };
  }
  /** Generate arguments that animate a finished image from its first frame with the chosen video profile. */
  async animate(owner, jobId, index, item, { tier, prompt, count = 1, cloud = false } = {}) {
    const output = await this.download(owner, jobId, index);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(output.mime)) throw new Error('Only image results can be animated.');
    const base = await this.choose(owner, { kind: 'video', tier, references: 1, firstFrame: true, cloud });
    const { asset } = await this.upload(owner, output.content.toString('base64'), `first-frame.${output.mime.split('/')[1]}`);
    const profile = { ...base, ...base.imageModes?.reference };
    const args = { profile_id: base.id, prompts: [prompt || item.prompt], count, reference_asset_ids: [asset.id] };
    // The video takes the image's proportions at the profile's default pixel count, snapped to its limits.
    const controls = mcpControls(profile);
    const { width, height } = await sharp(output.content, { limitInputPixels: 80000000 }).metadata();
    const scale = Math.sqrt((profile.defaults?.width * profile.defaults?.height) / (width * height));
    const size = controls.width && controls.height && scale > 0 ? referenceImageSize(profile, { width: width * scale, height: height * scale }) : null;
    if (size && (size.width !== profile.defaults?.width || size.height !== profile.defaults?.height)) Object.assign(args, size);
    return { profile: base, args };
  }
  async signedResult(owner, jobId, index) {
    if (!this.resolveSignedResult) throw new Error('The signed result is unavailable.');
    const result = await this.resolveSignedResult(owner, jobId, index);
    if (!result?.content || !result?.mime) throw new Error('The signed result is unavailable.');
    return result;
  }
  /** A chat-sized JPEG of an image output; other media pass through unchanged. */
  async previewOf(result) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(result.mime)) return result;
    const content = await sharp(result.content, { limitInputPixels: 80000000 }).rotate().resize({ width: previewSize, height: previewSize, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#fff' }).jpeg({ quality: 85 }).toBuffer();
    return { content, mime: 'image/jpeg' };
  }
  async readOutput(output, owner = "") {
    const response = await this.response('GET', output.url, undefined, owner);
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 128000000) throw new Error('Download large results directly from Studio.');
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
    const result = await this.request('POST', '/api/reference-assets/upload', form, owner);
    if (!result.asset?.id) throw new Error('Studio could not accept this reference image.');
    this.state.assets[result.asset.id] = [...new Set([...(this.state.assets[result.asset.id] ? [this.state.assets[result.asset.id]].flat() : []), owner])];
    this.save();
    return result;
  }
  async result(owner, jobId, index = 0, seconds = 0, delivery = 'preview', { scope = '', signal, detail = false } = {}) {
    const wait = Math.min(seconds, maxResultWaitSeconds);
    const job = await this.job(owner, jobId, wait, { signal });
    const ref = this.refOf(owner, scope, jobId);
    const label = ref ? `${ref[0].toUpperCase()}${ref.slice(1)}` : 'Studio result';
    const named = { job_id: jobId, ...(ref ? { ref } : {}), link: this.pageUrl(owner, jobId) };
    if (!finished.has(job.status)) {
      const pending = !terminal.has(job.status);
      const message = pending
        ? `${ref ? label : 'This job'} is still ${job.status || 'running'}. Reply now with its link; do not poll. It continues in the studio and appears at the link when done.`
        : job.cloudQuota ? `${cloudQuotaMessage} ${ref ? label : 'This job'} did not run; video needs the local video worker until the quota returns. Do not resubmit.`
          : failedReason(job) ? `${ref ? label : 'This job'} failed: ${failedReason(job)} Do not resubmit unless the user asks.`
            : `${ref ? label : 'This job'} ended with status ${job.status}. Do not resubmit unless the user asks.`;
      const summary = { ...named, ...this.summary(job), message };
      // The agent needs only the sentence and result link; detail adds the status fields.
      const lean = { job_id: jobId, ...(ref ? { ref } : {}), status: job.status || 'running' };
      return { content: [text(`${message} [${ref ? label : 'Result'}](${named.link})`), ...(detail ? [text(summary)] : [])], structuredContent: detail ? summary : lean };
    }
    this.available(job, index);
    // A preview shows the asked-for output; a notification carries every output of the job.
    const shown = delivery === 'notification' ? job : { ...job, outputs: job.outputs.map((item, position) => position === index ? item : {}) };
    const { outputs, markdown } = await this.markdown(owner, jobId, shown, label);
    const message = `${label} is ready. Reply with the markdown below exactly, plus at most one short sentence. Don't call Studio again for this request.`;
    // Only the markdown re-enters the chat by default; detail restores the full record.
    if (!detail) return { content: [text(`${message}\n\n${markdown}`)], structuredContent: { job_id: jobId, ...(ref ? { ref } : {}), status: 'done' } };
    const structured = { ...named, status: 'done', kind: job.kind, outputs, markdown, message };
    return { content: [text(`${message}\n\n${markdown}`), text(structured)], structuredContent: structured };
  }
  /**
   * A finished job's markdown: per output, a header naming its ref and profile, then its image
   * as a preview that links to the original (a View Video link for videos). The header and image
   * share one paragraph so renderers add no gap; outputs are blank-line separated.
   */
  async markdown(owner, jobId, job, label) {
    const outputs = (job.outputs || []).flatMap((item, index) => mcpOutputPath(item?.url) ? [{ output_index: index, url: this.url(owner, jobId, index) }] : []);
    const profile = job.profileId ? (await this.profiles('all', owner).catch(() => [])).find(item => item.id === job.profileId) : undefined;
    // The profile's short name, as its label reads before the first ' · '.
    const name = String(profile?.displayName || profile?.label || '').split(/\s*·\s*/)[0].trim();
    const markdown = outputs.map(({ output_index, url }, position) => {
      const caption = outputs.length > 1 ? `${label} (${position + 1} of ${outputs.length})` : label;
      if (job.kind === 'video') return [`**${caption}**`, name, `[View Video](${url})`].filter(Boolean).join(' · ');
      return `${[`**${caption}**`, name].filter(Boolean).join(' · ')}\n[![${caption}](${this.previewUrl(owner, jobId, output_index)})](${url})`;
    }).join('\n\n');
    return { outputs, markdown };
  }
  /**
   * Waits up to `seconds` for every job of a submission. Returns their markdown once all
   * finished with outputs; null when one is still running, failed, or the wait was cancelled.
   */
  async settle(owner, submission, seconds, { signal } = {}) {
    if (!seconds || submission.status !== 'queued') return null;
    // One unfinished job sends the whole submission to Result, so stop waiting for the rest.
    const stop = new AbortController();
    const linked = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
    // One shared deadline: the submission's jobs render together and the whole wait never exceeds `seconds`.
    const deadline = Date.now() + seconds * 1000;
    const jobs = await Promise.all(submission.jobs.map(async ({ job_id }) => {
      // A finer poll than Result's: every second counts while the chat waits.
      const job = await this.job(owner, job_id, Math.max(0, (deadline - Date.now()) / 1000), { signal: linked, interval: 1000 });
      if (!finished.has(job.status) || !job.outputs?.some(item => mcpOutputPath(item?.url))) throw new Error('Unfinished.');
      return job;
    })).catch(() => { stop.abort(); return null; });
    if (!jobs) return null;
    const blocks = await Promise.all(jobs.map((job, position) => {
      const { job_id, ref } = submission.jobs[position];
      return this.markdown(owner, job_id, job, ref ? `${ref[0].toUpperCase()}${ref.slice(1)}` : 'Studio result');
    }));
    return blocks.map(block => block.markdown).join('\n\n');
  }
  /** A conversation's most recent results by number, each with its job status; unreadable jobs are skipped. */
  async scopeJobs(owner, scope, { signal, credential } = {}) {
    const entry = this.state.refs[scope || this.referenceScope(owner)];
    const numbers = Object.keys(entry?.jobs || {}).map(Number).sort((left, right) => left - right).slice(-maxListedResults);
    const jobs = await Promise.all(numbers.map(async number => {
      const jobId = entry.jobs[number];
      try { return { number, jobId, job: await this.job(owner, jobId, 0, { signal, credential }) }; } catch (error) {
        if (error.aborted) throw error;
        return null;
      }
    }));
    return jobs.filter(item => item && item.job.status !== 'missing');
  }
  /**
   * Every finished result of a conversation as one reply ("show me all"): the most recent few as
   * markdown under their Result headers, and the All Results page when there are more or some are pending.
   */
  async resultsAll(owner, scope, { signal } = {}) {
    const jobs = await this.scopeJobs(owner, scope, { signal });
    if (!jobs.length) throw new Error('There are no results in this conversation yet.');
    const done = jobs.filter(({ job }) => finished.has(job.status) && job.outputs?.some(item => mcpOutputPath(item?.url)));
    const pending = jobs.filter(({ job }) => !terminal.has(job.status));
    const shown = done.slice(-maxShownResults);
    const blocks = await Promise.all(shown.map(({ number, jobId, job }) => this.markdown(owner, jobId, job, `Result ${number}`)));
    const all = done.length > 1 || pending.length ? `[All Results](${this.allUrl(owner, scope)})` : '';
    const pendingLinks = pending.map(({ number, jobId }) => `[Result ${number}](${this.pageUrl(owner, jobId)})`);
    const markdown = [...blocks.map(block => block.markdown), [...pendingLinks, all].filter(Boolean).join(' · ')].filter(Boolean).join('\n\n');
    const message = shown.length
      ? `${shown.length === 1 ? 'One result is' : `${shown.length} results are`} ready${pending.length ? `, ${pending.length} still running` : ''}. Reply with the markdown below exactly, plus at most one short sentence. Don't call Studio again for this request.`
      : 'No result has finished yet. Share the links below and end your turn; do not poll.';
    return { content: [text(`${message}\n\n${markdown}`)], structuredContent: { status: pending.length ? 'running' : 'done', results: jobs.map(({ number, jobId, job }) => ({ ref: `result ${number}`, job_id: jobId, status: job.status })) } };
  }
  /** The All Results page: every recent result of a conversation, filling in as jobs finish. */
  async allPage(claims, credential) {
    const jobs = await this.scopeJobs(claims.owner, claims.scope, { credential });
    if (!jobs.length) return null;
    const pending = jobs.some(({ job }) => !terminal.has(job.status));
    const sections = jobs.map(({ number, jobId, job }) => {
      const heading = `<h2>Result ${number}</h2>`;
      if (!terminal.has(job.status)) {
        const progress = Number.isFinite(job.progress) ? ` ${Math.round(job.progress > 1 ? job.progress : job.progress * 100)}%` : '';
        return `<section>${heading}<p>Still generating${escapeHtml(progress)}.</p></section>`;
      }
      const outputs = finished.has(job.status) ? (job.outputs || []).flatMap((item, index) => mcpOutputPath(item?.url) ? [this.shortId(claims.owner, jobId, index)] : []) : [];
      if (!outputs.length) return `<section>${heading}<p>${job.cloudQuota ? `${cloudQuotaMessage} This generation did not run.` : 'This generation did not produce a result.'}</p>${this.promptHtml(jobId)}</section>`;
      return `<section>${heading}${outputs.map(token => job.kind === 'video'
        ? `<figure><video src="${token}" controls playsinline preload="metadata"></video><a href="${token}">View Original</a></figure>`
        : `<figure><a href="${token}"><img src="${token}" alt="Result ${number}"></a><a href="${token}">View Original</a></figure>`).join('')}${this.promptHtml(jobId)}</section>`;
    }).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer">${pending ? '<meta http-equiv="refresh" content="5">' : ''}<title>All Results</title><style>body{font-family:system-ui,sans-serif;margin:1.5rem;color-scheme:light dark}figure{margin:0 0 1.5rem}img,video{display:block;max-width:100%;max-height:85vh;margin-bottom:.5rem}.prompt{max-width:60rem;opacity:.8;white-space:pre-wrap}</style></head><body><h1>All Results</h1>${sections}</body></html>`;
  }
  /** The watch page behind a p2 link; account mode reads as the signed owner through MCP's loopback credential. */
  async page(claims, credential) {
    let job;
    try { job = await this.job(claims.owner, claims.jobId, 0, { credential }); } catch { return null; }
    const outputs = finished.has(job.status) ? (job.outputs || []).flatMap((item, index) => mcpOutputPath(item?.url) ? [this.shortId(claims.owner, claims.jobId, index)] : []) : [];
    if (finished.has(job.status) && !outputs.length) return null;
    const pending = !terminal.has(job.status);
    const title = pending ? 'Generating…' : outputs.length ? 'Studio Result' : `Generation ${escapeHtml(job.status)}`;
    const progress = Number.isFinite(job.progress) ? ` ${Math.round(job.progress > 1 ? job.progress : job.progress * 100)}%` : '';
    const media = outputs.map(token => job.kind === 'video'
      ? `<figure><video src="${token}" controls playsinline preload="metadata"></video><a href="${token}">View Original</a></figure>`
      : `<figure><a href="${token}"><img src="${token}" alt="Studio result"></a><a href="${token}">View Original</a></figure>`).join('');
    const ended = job.cloudQuota ? `<p>${cloudQuotaMessage} This generation did not run.</p>` : '<p>This generation did not produce a result.</p>';
    const body = (pending ? `<p>Still generating${escapeHtml(progress)}. This page refreshes automatically.</p>` : outputs.length ? media : ended) + this.promptHtml(claims.jobId);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer">${pending ? '<meta http-equiv="refresh" content="5">' : ''}<title>${title}</title><style>body{font-family:system-ui,sans-serif;margin:1.5rem;color-scheme:light dark}figure{margin:0 0 1.5rem}img,video{display:block;max-width:100%;max-height:85vh;margin-bottom:.5rem}.prompt{max-width:60rem;opacity:.8;white-space:pre-wrap}</style></head><body><h1>${title}</h1>${body}</body></html>`;
  }
  /** The full prompt a job ran, for its result pages. */
  promptHtml(jobId) {
    const prompt = this.promptRecord(jobId)?.prompt;
    return prompt ? `<p class="prompt">${escapeHtml(prompt)}</p>` : '';
  }
  summary(job) { return Object.fromEntries(['status', 'kind', 'progress', 'error', 'failure'].filter(key => key in job).map(key => [key, job[key]])); }
}
