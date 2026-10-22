// SPDX-License-Identifier: AGPL-3.0-only
// Studio writes MCP prompts itself: one fresh call to an OpenAI-compatible chat model per generation,
// carrying the user's request and the target profile's full prompting guide. The call goes through
// the prompt assistant engine (assistant.js), so MCP Generate and the Studio assistant share one adapter.
import { AssistantError, createAssistant, gatewaySettings, maxPromptCharacters, stripThinking, writerGuide } from './assistant.js';

export { writerGuide };

const maxChanges = 8;

/** The writer's endpoint, key and model, or null when prompt writing is off; a partial setting fails by name. */
export function promptWriterSettings(environment = process.env) {
  const settings = gatewaySettings(environment);
  return settings ? { endpoint: settings.endpoint, key: settings.key, model: settings.model } : null;
}

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxPromptCharacters);

/** Prompts from a reply: JSON {"prompts": [...]}, a JSON array, or plain text for a single prompt. */
export function parseWrittenPrompts(content, count) {
  const body = stripThinking(content).replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1').trim();
  let prompts = null;
  const json = /[[{][\s\S]*[\]}]/.exec(body)?.[0];
  if (json) try {
    const parsed = JSON.parse(json);
    prompts = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.prompts) ? parsed.prompts : typeof parsed?.prompt === 'string' ? [parsed.prompt] : null;
  } catch { /* Not JSON; a single prompt may still be plain text. */ }
  if (!prompts && count === 1 && body && !/^[[{]/.test(body)) prompts = [body];
  prompts = (prompts || []).filter(item => typeof item === 'string').map(clean).filter(Boolean);
  if (!prompts.length) return null;
  // A short list repeats rather than failing: each repeat still gets its own seed.
  return Array.from({ length: count }, (_, index) => prompts[index % prompts.length]);
}

function instructions({ profile, guide, count, references, role }) {
  const label = profile.label || profile.id;
  const media = profile.kind === 'video' ? 'video' : 'image';
  const lines = [
    `You write prompts for the ${media} model ${label}. Follow its prompting guide below.`,
    `Reply with JSON only: {"prompts": [...]} with exactly ${count} complete, standalone prompt${count > 1 ? 's' : ''}, one per ${media}.`,
    'Keep every subject, detail, style, mood, framing and quoted text the user asked for; add only what the guide recommends to realise it, never new subjects or content the user did not imply.',
    'Words about speed, quality tier, model, size, aspect or count (such as "turbo", "fast", "landscape", "16:9", "2K", "two images") are settings, not scene: leave them out.',
    count > 1 ? `If the request names ${count} different ${media}s, write one prompt for each; otherwise vary composition and details between the prompts while each matches the request.` : '',
    'When changes follow the request, apply all of them to the request in order and keep everything else.',
    references ? (profile.kind === 'video' && role === 'first-frame'
      ? 'The supplied image is the first frame: describe the motion, action and camera from that frame without re-describing what is already visible.'
      : `${references} reference image${references > 1 ? 's are' : ' is'} supplied${role ? ` as ${role}` : ''}; follow the guide's editing advice.`) : '',
    `Prompting guide: ${guide || '(none; write a clear, specific natural-language prompt)'}`
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * A prompt writer, or null when prompt writing is off. write() returns { prompts, source, ms }:
 * source "studio" for written prompts, "request" when it fell back to the given prompts.
 * Generate keeps the prompt writer's own model (STUDIO_PROMPT_WRITER_MODEL), a fast one.
 * A chat waits on it before anything queues, so a slow gateway falls back to the request itself after 15 s.
 */
export function createPromptWriter(environment = process.env, { fetchImpl = fetch, timeoutMs = 15000, log = console } = {}) {
  const settings = promptWriterSettings(environment);
  if (!settings) return null;
  const engine = createAssistant(environment, { fetchImpl, timeoutMs, log: {} });
  return {
    model: settings.model,
    async write({ profile, guide, request, changes = [], count = 1, references = 0, role = '', fallback, signal }) {
      const started = Date.now();
      const user = [`Request: ${clean(request)}`, ...changes.slice(-maxChanges).map(change => `Change: ${clean(change)}`)].join('\n');
      let reason;
      try {
        const reply = await engine.chat({
          model: settings.model,
          messages: [{ role: 'system', content: instructions({ profile, guide: writerGuide(guide), count, references, role }) }, { role: 'user', content: user }],
          temperature: 0.7,
          maxTokens: 400 * count + 200,
          signal
        });
        const prompts = parseWrittenPrompts(reply.text, count);
        if (prompts) {
          log.info?.(`MCP prompt writer: ${count} prompt${count > 1 ? 's' : ''} for ${profile.id} in ${Date.now() - started} ms`);
          return { prompts, source: 'studio', ms: Date.now() - started };
        }
        reason = 'unusable reply';
      } catch (error) {
        if (signal?.aborted) throw error;
        reason = error instanceof AssistantError ? error.reason : 'unreachable';
      }
      log.warn?.(`MCP prompt writer fell back to the request for ${profile.id} after ${Date.now() - started} ms: ${reason}`);
      return { prompts: fallback, source: 'request', ms: Date.now() - started };
    }
  };
}
