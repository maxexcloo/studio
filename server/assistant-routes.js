// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The prompt assistant's routes. Every route is account-scoped: it needs the Prompt Assistant
 * access-profile feature, works only with profiles the account may use, and Spicy needs NSFW Models.
 * LoRA suggestions need the LoRAs feature. Drafting guides and profiles is for administrators.
 *
 *   GET  /api/assistant                 what this account may use: presets, models, vision
 *   POST /api/assistant/rewrite         { profileId, prompt, preset, references?, loras? } → streamed
 *                                       (text/event-stream: delta, done, error) or JSON
 *   POST /api/assistant/negative        { profileId, prompt, cfg?, loras? } → { negative | null, unused }
 *   POST /api/assistant/loras           { profileId, prompt } → { loras: [{ name, title, strength, triggers, reason }] }
 *   POST /api/assistant/describe        { image, hint?, profileId? } → { prompt, negative, profileId, loras }
 *   POST /api/assistant/draft-guide     admin: { profileId, sourceText, nearestPackId? } → { guide, aiDrafted }
 *   POST /api/assistant/draft-profile   admin: { id, templateId, modelFile, recommended?, sourceText? } → { text, check, aiDrafted }
 *   GET  /api/assistant/models          admin: the gateway's models, for Settings
 *
 * Nothing here saves a draft: later phases store them through profile-store.js.
 */
import { AssistantError, assistantModelKey, assistantSettings, assistantSpicyModelKey, createAssistant } from './assistant.js';
import { assistantPresets, defaultPreset } from './assistant-presets.js';
import { mayUseFeature } from './account-policy.js';
import { loadSharp } from './sharp-loader.js';

const maxReferences = 4;
const maxImageBytes = 12 * 1024 * 1024;
const referenceEdge = 1024;
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;

export const assistantSettingKeys = Object.freeze([assistantModelKey, assistantSpicyModelKey]);

/** Whether an account (or single-user Studio, with no account) has a feature. */
const allowed = (req, feature) => !req.studioAccount || mayUseFeature(req.studioAccount, feature);
const isAdministrator = (req) => !req.studioAccount || req.studioAccount.role === 'administrator';

/** A pasted image as { mime, data } (base64), or null. */
export function imageFromDataUrl(value) {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(value || ''));
  if (!match) return null;
  const data = match[2].replace(/\s+/g, '');
  if (Math.floor(data.length * 3 / 4) > maxImageBytes) return null;
  return { mime: match[1], data };
}

/** References downscaled (longest edge 1024 px, JPEG) so a vision call stays small; unresized without sharp. */
export async function downscaleReferences(values) {
  const images = (Array.isArray(values) ? values : []).slice(0, maxReferences).map(imageFromDataUrl).filter(Boolean);
  const sharp = images.length ? await loadSharp() : null;
  if (!sharp) return images;
  return Promise.all(images.map(async (image) => {
    try {
      const data = await sharp(Buffer.from(image.data, 'base64')).rotate().resize({ width: referenceEdge, height: referenceEdge, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
      return { mime: 'image/jpeg', data: data.toString('base64') };
    } catch { return image; }
  }));
}

/** Settings › Models › Integrations: the assistant's gateway, chosen models and vision. */
export async function assistantIntegration({ environment = process.env, engine, source }) {
  let settings = null;
  let problem = '';
  try { settings = assistantSettings(environment); } catch (error) { problem = error.message; }
  const row = (key, effective) => ({ key, configured: String(environment[key] || '').trim(), effective, ...source(key) });
  if (!settings || !engine) return { available: false, note: problem || 'Set STUDIO_PROMPT_WRITER_URL, _KEY and _MODEL to use the prompt assistant.', models: [], model: row(assistantModelKey, ''), spicy: row(assistantSpicyModelKey, ''), writerModel: '' };
  const [models, vision, spicyVision] = await Promise.all([engine.listModels(), engine.supportsVision(settings.model), settings.spicyModel ? engine.supportsVision(settings.spicyModel) : false]);
  return { available: true, writerModel: settings.writerModel, models, model: { ...row(assistantModelKey, settings.model), vision }, spicy: { ...row(assistantSpicyModelKey, settings.spicyModel), vision: spicyVision } };
}

/** Checks a model name for the two assistant settings; '' clears it. */
export function assistantSettingValue(key, value) {
  if (!assistantSettingKeys.includes(key)) throw new Error('That setting cannot be changed here.');
  const model = String(value ?? '').trim();
  if (model && !modelPattern.test(model)) throw new Error('Choose a valid model name.');
  return model;
}

/**
 * `profiles(req)`: the generation profiles this account may use (account-scoped). `guide(profile)`:
 * its detailed prompting guide. `loras(req)`: [{ name, info }] the account may stack. `starred(req,
 * profile)`: { examples, loras } from starred results on the same family. `template(id)`: a profile's
 * workflow JSON. `checkProfile(id, text)`: validateProfileText's result. `pack(id)`: a guide pack.
 */
export function registerAssistantRoutes(app, {
  environment = process.env, fetchImpl = fetch, engine = createAssistant(environment, { fetchImpl }),
  profiles = async () => [], guide = () => null, loras = async () => [], starred = async () => ({ examples: [], loras: [] }),
  template = async () => null, checkProfile = async () => ({ ok: true, errors: [], warnings: [] }), pack = () => null,
  requireAdmin = (req, res) => { if (isAdministrator(req)) return true; res.status(403).json({ ok: false, error: 'This action is restricted to administrators.' }); return false; }
} = {}) {
  const fail = (res, error) => {
    const status = error instanceof AssistantError ? error.status : Number(error?.status) || 400;
    res.status(status >= 400 && status < 600 ? status : 502).json({ ok: false, error: error instanceof AssistantError && error.status >= 500 ? `The prompt assistant is unavailable (${error.reason}).` : error.message });
  };
  /** The engine and the account's profile, or an answer explaining why not. */
  const ready = async (req, res, { profileRequired = true } = {}) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!engine) { res.status(503).json({ ok: false, error: 'The prompt assistant is not configured.' }); return null; }
    if (!allowed(req, 'promptAssistant')) { res.status(403).json({ ok: false, error: 'The prompt assistant is off for this account.' }); return null; }
    const id = String(req.body?.profileId || '');
    if (!id && !profileRequired) return { profile: {}, guide: null };
    const profile = (await profiles(req)).find((item) => item.id === id);
    if (!profile) { res.status(404).json({ ok: false, error: 'Choose a model this account can use.' }); return null; }
    return { profile, guide: guide(profile) };
  };
  const stackFrom = async (req, names) => {
    if (!Array.isArray(names) || !names.length || !allowed(req, 'loras')) return { stack: [], infos: {} };
    const known = new Map((await loras(req)).map((item) => [item.name, item.info || {}]));
    const stack = names.map((item) => String(typeof item === 'string' ? item : item?.name || '')).filter((name) => known.has(name)).slice(0, 8).map((name) => ({ name, triggers: known.get(name).triggers || [] }));
    return { stack, infos: Object.fromEntries(stack.map(({ name }) => [name, known.get(name)])) };
  };

  app.get('/api/assistant', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!engine || !allowed(req, 'promptAssistant')) return res.json({ ok: true, available: false, presets: [] });
    try {
      const settings = engine.settings();
      const spicy = Boolean(settings.spicyModel) && allowed(req, 'nsfwModels');
      res.json({
        ok: true, available: true, model: settings.model, vision: await engine.supportsVision(settings.model), defaultPreset,
        presets: assistantPresets.filter((preset) => !preset.spicy || spicy).map(({ id, label, description }) => ({ id, label, description })),
        spicy, loras: allowed(req, 'loras')
      });
    } catch (error) { fail(res, error); }
  });

  app.post('/api/assistant/rewrite', async (req, res) => {
    const context = await ready(req, res);
    if (!context) return;
    const preset = String(req.body?.preset || defaultPreset);
    if (preset === 'spicy' && !allowed(req, 'nsfwModels')) return res.status(403).json({ ok: false, error: 'Spicy needs NSFW Models for this account.' });
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableFinished) controller.abort(); });
    const streaming = req.body?.stream === true || /text\/event-stream/i.test(String(req.headers.accept || ''));
    try {
      const references = await downscaleReferences(req.body?.references);
      const { stack } = await stackFrom(req, req.body?.loras);
      // Learning from stars: the account's starred prompts on this family, computed per request.
      const examples = (await starred(req, context.profile)).examples || [];
      const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      if (streaming) {
        // Before the first byte, so a refusal (Spicy without a model) is still a plain JSON error.
        if (preset === 'spicy' && !engine.settings().spicyModel) throw new AssistantError('Spicy needs a Spicy model. An administrator chooses one in Settings › Models › Integrations.', { status: 409 });
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
        res.flushHeaders?.();
      }
      const result = await engine.rewrite({
        profile: context.profile, guide: context.guide, prompt: req.body?.prompt, preset, references, stack, examples,
        negative: context.profile.capabilities?.negativePrompt !== false, signal: controller.signal,
        onDelta: streaming ? (text) => send('delta', { text }) : undefined
      });
      if (streaming) { send('done', result); res.end(); }
      else res.json({ ok: true, ...result });
    } catch (error) {
      if (controller.signal.aborted) return res.end();
      if (res.headersSent) { res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`); res.end(); return; }
      fail(res, error);
    }
  });

  app.post('/api/assistant/negative', async (req, res) => {
    const context = await ready(req, res);
    if (!context) return;
    try {
      const { stack, infos } = await stackFrom(req, req.body?.loras);
      const cfg = Number(req.body?.cfg);
      res.json({ ok: true, ...await engine.negative({ profile: context.profile, guide: context.guide, prompt: req.body?.prompt, cfg: Number.isFinite(cfg) ? cfg : undefined, stack, infos }) });
    } catch (error) { fail(res, error); }
  });

  app.post('/api/assistant/loras', async (req, res) => {
    const context = await ready(req, res);
    if (!context) return;
    if (!allowed(req, 'loras')) return res.status(403).json({ ok: false, error: 'LoRAs are off for this account.' });
    try {
      const favourite = await starred(req, context.profile);
      res.json({ ok: true, ...await engine.matchLoras({ profile: context.profile, prompt: req.body?.prompt, loras: await loras(req), starred: favourite.loras || [] }) });
    } catch (error) { fail(res, error); }
  });

  app.post('/api/assistant/describe', async (req, res) => {
    const context = await ready(req, res, { profileRequired: false });
    if (!context) return;
    try {
      const images = await downscaleReferences([req.body?.image].filter(Boolean));
      const visible = (await profiles(req)).map(({ id, label }) => ({ id, label }));
      const offered = allowed(req, 'loras') ? await loras(req) : [];
      res.json({ ok: true, ...await engine.describe({ images, hint: req.body?.hint, profile: context.profile, guide: context.guide, profiles: visible, loras: offered }) });
    } catch (error) { fail(res, error); }
  });

  app.post('/api/assistant/draft-guide', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const context = await ready(req, res);
    if (!context) return;
    try {
      const nearest = req.body?.nearestPackId ? pack(String(req.body.nearestPackId)) : context.guide;
      res.json({ ok: true, ...await engine.draftGuide({ profile: context.profile, family: context.profile.family, sourceText: req.body?.sourceText, nearest }) });
    } catch (error) { fail(res, error); }
  });

  app.post('/api/assistant/draft-profile', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const context = await ready(req, res, { profileRequired: false });
    if (!context) return;
    try {
      const id = String(req.body?.id || '');
      if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(id)) throw new Error('Choose a profile id: lowercase letters, digits, dots, dashes or underscores.');
      const base = await template(String(req.body?.templateId || ''));
      if (!base) throw Object.assign(new Error('That template profile was not found.'), { status: 404 });
      const drafted = await engine.draftProfile({ id, template: base, modelFile: String(req.body?.modelFile || ''), recommended: req.body?.recommended || {}, sourceText: req.body?.sourceText, nsfw: typeof req.body?.nsfw === 'boolean' ? req.body.nsfw : undefined });
      const text = `${JSON.stringify(drafted.profile, null, 2)}\n`;
      const { raw: _raw, ...check } = await checkProfile(id, text);
      res.json({ ok: true, text, check, aiDrafted: true, source: drafted.source });
    } catch (error) { fail(res, error); }
  });

  app.get('/api/assistant/models', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, models: engine ? await engine.listModels() : [] });
  });

  return engine;
}
