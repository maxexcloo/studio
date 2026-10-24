// SPDX-License-Identifier: AGPL-3.0-only
// Studio writes MCP prompts itself: one fresh call to an OpenAI-compatible chat model per generation,
// carrying the user's request and the target profile's full prompting guide. The call goes through
// the prompt assistant engine (assistant.js), so MCP Generate and the Studio assistant share one adapter.
import {
  AssistantError,
  createAssistant,
  gatewaySettings,
  maxPromptCharacters,
  stripThinking,
  writerGuide,
} from "./assistant.js";

export { writerGuide };

const maxChanges = 8;

/** The writer's endpoint, key and model, or null when prompt writing is off; a partial setting fails by name. */
export function promptWriterSettings(environment = process.env) {
  const settings = gatewaySettings(environment);
  return settings
    ? { endpoint: settings.endpoint, key: settings.key, model: settings.model }
    : null;
}

const clean = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxPromptCharacters);

/** Prompts from a reply: JSON {"prompts": [...]}, a JSON array, or plain text for a single prompt. */
export function parseWrittenPrompts(content, count) {
  const body = stripThinking(content)
    .replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1")
    .trim();
  let prompts = null;
  const json = /[[{][\s\S]*[\]}]/.exec(body)?.[0];
  if (json)
    try {
      const parsed = JSON.parse(json);
      prompts = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.prompts)
          ? parsed.prompts
          : typeof parsed?.prompt === "string"
            ? [parsed.prompt]
            : null;
    } catch {
      /* Not JSON; a single prompt may still be plain text. */
    }
  if (!prompts && count === 1 && body && !/^[[{]/.test(body)) prompts = [body];
  prompts = (prompts || [])
    .filter((item) => typeof item === "string")
    .map(clean)
    .filter(Boolean);
  if (!prompts.length) return null;
  // A short list repeats rather than failing: each repeat still gets its own seed.
  return Array.from({ length: count }, (_, index) => prompts[index % prompts.length]);
}

/** Up to three concept suggestions from a reply's JSON "suggestions", or none. */
function parseSuggestions(content) {
  try {
    const json = /\{[\s\S]*\}/.exec(stripThinking(content))?.[0];
    const list = json ? JSON.parse(json).suggestions : null;
    return Array.isArray(list)
      ? list
          .filter((item) => typeof item === "string")
          .map((item) => clean(item).slice(0, 200))
          .filter(Boolean)
          .slice(0, 3)
      : [];
  } catch {
    return [];
  }
}

function instructions({ profile, guide, count, references, role, suggest }) {
  const label = profile.label || profile.id;
  const media = profile.kind === "video" ? "video" : "image";
  const lines = [
    `You write prompts for the ${media} model ${label}. Follow its prompting guide below.`,
    `Reply with JSON only: {"prompts": [...]} with exactly ${count} complete, standalone prompt${count > 1 ? "s" : ""}, one per ${media}.`,
    "Keep every subject, detail, style, mood, framing and quoted text the user asked for; add only what the guide recommends to realise it, never new subjects or content the user did not imply.",
    'Words about speed, quality tier, model, size, aspect or count (such as "turbo", "fast", "landscape", "16:9", "2K", "two images") are settings, not scene: leave them out.',
    count > 1
      ? `If the request names ${count} different ${media}s, write one prompt for each; otherwise vary composition and details between the prompts while each matches the request.`
      : "",
    "When changes follow the request, apply all of them to the request in order and keep everything else.",
    references
      ? profile.kind === "video" && role === "first-frame"
        ? "The supplied image is the first frame: describe the motion, action and camera from that frame without re-describing what is already visible."
        : `${references} reference image${references > 1 ? "s are" : " is"} supplied${role ? ` as ${role}` : ""}; follow the guide's editing advice.`
      : "",
    suggest
      ? 'Also add "suggestions": 2 or 3 one-sentence ideas that would improve the concept; they are shown to the user, not put in the prompts.'
      : "",
    `Prompting guide: ${guide || "(none; write a clear, specific natural-language prompt)"}`,
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * A prompt writer, or null when prompt writing is off. write() returns { prompts, source, ms }, with
 * `suggestions` for the concept when asked (`suggest`):
 * source "studio" for written prompts, "request" when it fell back to the given prompts.
 * Generate keeps the prompt writer's own model (STUDIO_PROMPT_WRITER_MODEL), a fast one.
 * A chat waits on it before anything queues, so a slow gateway falls back to the request itself after 15 s.
 */
export function createPromptWriter(
  environment = process.env,
  { fetchImpl = fetch, timeoutMs = 15000, log = console } = {},
) {
  const settings = promptWriterSettings(environment);
  if (!settings) return null;
  const engine = createAssistant(environment, { fetchImpl, timeoutMs, log: {} });
  return {
    model: settings.model,
    async write({
      profile,
      guide,
      request,
      changes = [],
      count = 1,
      references = 0,
      role = "",
      suggest = false,
      fallback,
      signal,
    }) {
      const started = Date.now();
      const user = [
        `Request: ${clean(request)}`,
        ...changes.slice(-maxChanges).map((change) => `Change: ${clean(change)}`),
      ].join("\n");
      let reason;
      try {
        const reply = await engine.chat({
          model: settings.model,
          messages: [
            {
              role: "system",
              content: instructions({
                profile,
                guide: writerGuide(guide),
                count,
                references,
                role,
                suggest,
              }),
            },
            { role: "user", content: user },
          ],
          temperature: 0.7,
          maxTokens: 400 * count + (suggest ? 350 : 200),
          signal,
        });
        const prompts = parseWrittenPrompts(reply.text, count);
        if (prompts) {
          log.info?.(
            `MCP prompt writer: ${count} prompt${count > 1 ? "s" : ""} for ${profile.id} in ${Date.now() - started} ms`,
          );
          return {
            prompts,
            source: "studio",
            ms: Date.now() - started,
            ...(suggest ? { suggestions: parseSuggestions(reply.text) } : {}),
          };
        }
        reason = "unusable reply";
      } catch (error) {
        if (signal?.aborted) throw error;
        reason = error instanceof AssistantError ? error.reason : "unreachable";
      }
      log.warn?.(
        `MCP prompt writer fell back to the request for ${profile.id} after ${Date.now() - started} ms: ${reason}`,
      );
      return { prompts: fallback, source: "request", ms: Date.now() - started };
    },
    /**
     * The profile in `profiles` that suits the request best, with a one-line reason, or null when the
     * reply is unusable or slow (8 s), so Studio's usual pick stands. `preferred` is that usual pick.
     */
    async pick({ request, profiles, preferred, signal }) {
      const line = (profile) =>
        `- ${profile.id}: ${profile.label || profile.id}${profile.id === preferred?.id ? " (default)" : ""}. ${clean(profile.description).slice(0, 300)}${profile.prompting?.summary ? ` Prompting: ${clean(profile.prompting.summary).slice(0, 200)}` : ""}`;
      try {
        const reply = await engine.chat({
          model: settings.model,
          messages: [
            {
              role: "system",
              content: [
                "Choose the model that suits this generation request best.",
                'Reply with JSON only: {"id": "<model id>", "reason": "<why, in at most 12 words>"}.',
                "Keep the default unless another model clearly suits the request better, such as for legible text or explicit content.",
                `Models:\n${profiles.map(line).join("\n")}`,
              ].join("\n"),
            },
            { role: "user", content: `Request: ${clean(request)}` },
          ],
          temperature: 0,
          maxTokens: 300,
          timeout: 8000,
          signal,
        });
        const json = /\{[\s\S]*\}/.exec(stripThinking(reply.text))?.[0];
        const { id, reason } = json ? JSON.parse(json) : {};
        const profile = profiles.find((item) => item.id === id);
        const why = clean(reason)
          .replace(/[.\s]+$/, "")
          .slice(0, 120);
        return profile && why ? { profile, reason: why } : null;
      } catch (error) {
        if (signal?.aborted) throw error;
        return null;
      }
    },
  };
}
