// SPDX-License-Identifier: AGPL-3.0-only
// The prompt assistant's MCP tools: RewritePrompt, SuggestNegative and SuggestLoras. Each one calls
// Studio's own /api/assistant routes with the account's credential, so the chat and the composer
// share one engine and one set of rules (Prompt Assistant, NSFW Models for Spicy, LoRAs, the
// account's profiles). What the chat used is remembered briefly, so a Generate with that prompt
// records it on the result (`assistant`, source "chat") for Details and Recreate.
import { z } from 'zod';
import { assistantPresets, defaultPreset } from './assistant-presets.js';
import { mcpJson } from './mcp-media.js';

const maxRemembered = 512;
const rememberMs = 6 * 60 * 60 * 1000;
const maxReferences = 4;
const key = (owner, prompt) => JSON.stringify([owner || '', String(prompt || '').replace(/\s+/g, ' ').trim().toLowerCase()]);

/** What each owner's chat recently had written or suggested, for the generation record. */
export function createChatAssistantMemory({ now = Date.now } = {}) {
  const rewrites = new Map();
  const suggested = new Map();
  const keep = (map, id, value) => {
    map.delete(id);
    if (map.size >= maxRemembered) map.delete(map.keys().next().value);
    map.set(id, { ...value, at: now() });
  };
  const fresh = (entry) => entry && now() - entry.at < rememberMs ? entry : null;
  return {
    rewrote(owner, prompt, { preset, model }) { keep(rewrites, key(owner, prompt), { preset, model }); },
    suggested(owner, names) { keep(suggested, owner || '', { names: [...new Set([...(fresh(suggested.get(owner || ''))?.names || []), ...names])].slice(-32) }); },
    /** The `assistant` record for a run of these prompts with this stack, or null when the chat wrote none of them. */
    record(owner, prompts = [], loras = []) {
      const written = prompts.map((prompt) => fresh(rewrites.get(key(owner, prompt)))).find(Boolean);
      if (!written) return null;
      const offered = new Set(fresh(suggested.get(owner || ''))?.names || []);
      const chosen = loras.map((item) => item?.name).filter((name) => name && offered.has(name));
      return { preset: written.preset, ...(written.model ? { model: written.model } : {}), source: 'chat', ...(chosen.length ? { lorasSuggested: [...new Set(chosen)] } : {}) };
    }
  };
}

/**
 * Registers the three tools. `tool` is mcp.js's registration helper, `profileOf(name)` resolves a
 * profile id or name the way Generate does, and `memory` is createChatAssistantMemory's.
 */
export function registerAssistantTools({ tool, server, media, owner, profileOf, memory }) {
  const presetIds = assistantPresets.map((preset) => preset.id);
  const prompt = z.string().trim().min(1).max(4000);
  const profileId = z.string().min(1).describe('The profile the prompt is for: an id or name from Models.');
  const ask = (route, body, signal) => media.request('POST', `/api/assistant/${route}`, body, owner, { signal });
  /** A reference the account uploaded, as the data URL the assistant reads (a vision model only). */
  const reference = async (id, signal) => {
    media.own(owner, id, 'assets');
    const response = await media.response('GET', `/api/reference-assets/${encodeURIComponent(id)}/media`, undefined, owner, { signal });
    const type = String(response.headers.get('content-type') || 'image/png').split(';')[0];
    return `data:${type};base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`;
  };

  tool(server, 'RewritePrompt', 'Rewrite Prompt', `Rewrite a prompt for a profile with a preset (${presetIds.join(', ')}; Spicy needs NSFW access), the way Studio's magic button does. Only when the user asks to improve, rewrite or restyle a prompt; Generate already writes prompts from requests. A vision model reads reference_asset_ids from Upload. Show the result; pass it to Generate as prompts with exact_prompt.`, {
    prompt, profile_id: profileId, preset: z.enum(presetIds).default(defaultPreset), reference_asset_ids: z.array(z.string().min(1)).max(maxReferences).optional()
  }, async ({ prompt: text, profile_id, preset, reference_asset_ids = [] }, signal) => {
    const profile = await profileOf(profile_id);
    const references = await Promise.all(reference_asset_ids.map((id) => reference(id, signal)));
    const written = await ask('rewrite', { profileId: profile.id, prompt: text, preset, references }, signal);
    if (written.source === 'fallback') return mcpJson({ prompt: text, preset, unchanged: true, reason: `The assistant couldn’t rewrite it (${written.reason || 'unavailable'}); the prompt is unchanged.` });
    memory.rewrote(owner, written.prompt, { preset: written.preset, model: written.model });
    return mcpJson({ prompt: written.prompt, preset: written.preset, model: written.model, profile_id: profile.id, ...(references.length ? { references_read: Boolean(written.referencesRead) } : {}) });
  }, { readOnlyHint: true });

  tool(server, 'SuggestNegative', 'Suggest Negative', 'Write a negative prompt for a prompt and profile, only when asked. Returns unused: true when the profile takes none; then pass no negative_prompt.', {
    prompt, profile_id: profileId
  }, async ({ prompt: text, profile_id }, signal) => {
    const profile = await profileOf(profile_id);
    const written = await ask('negative', { profileId: profile.id, prompt: text }, signal);
    return mcpJson(written.unused ? { unused: true } : { negative: written.negative });
  }, { readOnlyHint: true });

  tool(server, 'SuggestLoras', 'Suggest LoRAs', 'Suggest LoRAs from the profile’s library for a prompt, only when asked: name, title, strength, triggers and a reason. Pass chosen ones to Generate as loras; with exact_prompt, add their triggers yourself.', {
    prompt, profile_id: profileId
  }, async ({ prompt: text, profile_id }, signal) => {
    const profile = await profileOf(profile_id);
    const { loras = [] } = await ask('loras', { profileId: profile.id, prompt: text }, signal);
    memory.suggested(owner, loras.map((item) => item.name));
    return mcpJson({ profile_id: profile.id, loras: loras.map(({ name, title, strength, triggers, reason }) => ({ name, title, strength, triggers, reason })) });
  }, { readOnlyHint: true });
}
