// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The prompt assistant engine: one OpenAI-compatible adapter behind every assistant
 * operation, shared by the Studio UI routes (assistant-routes.js), MCP Generate's prompt writer
 * (prompt-writer.js) and later the MCP assistant and admin tools, so they cannot drift apart.
 *
 * It uses the prompt writer's gateway credentials (STUDIO_PROMPT_WRITER_URL, _KEY) and asks Bifrost
 * for a route and reasoning level by name (`model()`): the local route while a local text workload
 * runs, otherwise STUDIO_PROMPT_WRITER_MODEL's cloud route. STUDIO_ASSISTANT_MODEL, when an
 * administrator sets it, replaces both for everything but MCP Generate's writer. Settings are read
 * on every call, so a model chosen in Settings applies at once.
 *
 * Every call has a timeout, strips `<think>` reasoning, and never logs prompt text. Each operation
 * has a deterministic fallback for when the model fails: the original prompt, the guide's negative,
 * or the LoRA pre-filter.
 */
import { assistantPreset, defaultPreset, familyUpsampler } from "./assistant-presets.js";
import { loraCompatibility, loraName, strengthRange } from "./lora-policy.js";
import { cleanTriggers } from "./lora-catalogue.js";
import { negativeUnused, recommendedNegative } from "./lora-prompts.js";
import { replyTitle } from "../shared/titles.ts";
import { captionCharacters, captionInstructions, captionTags } from "./domain/captions.ts";
import { userContent } from "./domain/model-content.ts";

const gatewayKeys = [
  "STUDIO_PROMPT_WRITER_URL",
  "STUDIO_PROMPT_WRITER_KEY",
  "STUDIO_PROMPT_WRITER_MODEL",
];
export const assistantModelKey = "STUDIO_ASSISTANT_MODEL";
// Guide parts about settings or provenance; prompt writing only needs what shapes the prompt.
const omittedGuideKeys = new Set(["reviewed_on", "sampling", "sources"]);
export const maxPromptCharacters = 4000;
const titleInstructions =
  "Title this image or video from the prompt that made it. Reply with only a very concise Title Case title of two to five words naming its subject, without quotes or punctuation.";
// The Bifrost reasoning level each call asks for: `off` where it wants a structured (JSON) answer,
// `text` where it writes prose.
export const textLevels = {
  animate: "text",
  caption: "off",
  describe: "off",
  dream: "off",
  guide: "off",
  loras: "off",
  negative: "text",
  pick: "off",
  profile: "off",
  rewrite: "text",
  suggestions: "off",
  taste: "text",
  title: "text",
  writer: "off",
};
const maxCandidates = 20;
const maxExamples = 6;
const lookupTtlMs = 10 * 60_000;
const failedLookupTtlMs = 60_000;

/** An assistant failure with a short reason for logs and callers ("HTTP 401", "timeout"); never prompt text. */
export class AssistantError extends Error {
  constructor(reason, { status = 502, cause } = {}) {
    super(reason, cause ? { cause } : undefined);
    this.name = "AssistantError";
    this.reason = reason;
    this.status = status;
  }
}

/**
 * The gateway endpoint, key and cloud route prefix (STUDIO_PROMPT_WRITER_MODEL, such as `cloud/`), or
 * null when unset; a partial setting fails by name.
 */
export function gatewaySettings(environment = process.env) {
  const values = Object.fromEntries(
    gatewayKeys.map((key) => [key, String(environment[key] || "").trim()]),
  );
  if (gatewayKeys.every((key) => !values[key])) return null;
  const missing = gatewayKeys.filter((key) => !values[key]);
  if (missing.length)
    throw new Error(
      `Prompt writing needs ${missing.join(", ")}; set all three of ${gatewayKeys.join(", ")} or none.`,
    );
  if (!values.STUDIO_PROMPT_WRITER_MODEL.endsWith("/"))
    throw new Error(
      "STUDIO_PROMPT_WRITER_MODEL must be a route prefix ending in /, such as cloud/.",
    );
  return {
    ...gatewayAddress(values.STUDIO_PROMPT_WRITER_URL, "STUDIO_PROMPT_WRITER_URL"),
    key: values.STUDIO_PROMPT_WRITER_KEY,
    cloud: values.STUDIO_PROMPT_WRITER_MODEL,
  };
}

/** Both text consumers accept a gateway root, /v1 base or full completion endpoint. */
export function gatewayAddress(value, setting) {
  let url;
  try {
    url = new URL(value);
  } catch {
    url = null;
  }
  if (
    !url ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      `${setting} must be an absolute HTTP(S) URL without credentials, query or fragment.`,
    );
  const base = url.href.replace(/\/+$/, "");
  const endpoint = /\/chat\/completions$/.test(base)
    ? base
    : /\/v1$/.test(base)
      ? `${base}/chat/completions`
      : `${base}/v1/chat/completions`;
  const root = endpoint.replace(/\/(?:v1\/)?chat\/completions$/, "");
  return { endpoint, root };
}

/** The gateway plus the model an administrator chose (empty for none), or null while the gateway is unset. */
export function assistantSettings(environment = process.env) {
  const gateway = gatewaySettings(environment);
  if (!gateway) return null;
  return { ...gateway, chosen: String(environment[assistantModelKey] || "").trim() };
}

/** The guide without provenance or sampling notes, as compact JSON. */
export function writerGuide(guide) {
  const prune = (value) =>
    Array.isArray(value)
      ? value.map(prune)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([key]) => !omittedGuideKeys.has(key))
              .map(([key, item]) => [key, prune(item)]),
          )
        : value;
  return guide && typeof guide === "object" ? JSON.stringify(prune(guide)) : "";
}

/**
 * A reply without its reasoning: every `<think>…</think>` block, an unclosed `<think>` to the end,
 * and anything before an orphan `</think>` (templates that open the block themselves).
 */
export function stripThinking(text) {
  let body = String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "");
  const orphan = body.search(/<\/think>/i);
  if (orphan >= 0) body = body.slice(orphan + "</think>".length);
  body = body.replace(/<think>[\s\S]*$/i, "");
  return body.trim();
}

/** The reasoning in a reply: its `<think>` blocks (an orphan `</think>` closes one opened by the template). */
function replyThinking(text) {
  const body = String(text || "");
  const orphan = body.search(/<\/think>/i);
  const parts = [];
  if (orphan >= 0 && !/<think>/i.test(body.slice(0, orphan))) parts.push(body.slice(0, orphan));
  for (const match of body.matchAll(/<think>([\s\S]*?)(?:<\/think>|$)/gi)) parts.push(match[1]);
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Strips `<think>` blocks from a stream as it arrives, holding back only what could still be the
 * start of a tag. push() returns the text safe to show; flush() returns what is left at the end.
 * `onThinking` hears the reasoning inside the blocks as it arrives.
 */
export function createThinkFilter(onThinking = () => {}) {
  const open = "<think>";
  const close = "</think>";
  let pending = "";
  let thinking = false;
  let started = false;
  const partial = (text, tag) => {
    const lower = text.toLowerCase();
    for (let size = Math.min(tag.length - 1, text.length); size > 0; size -= 1)
      if (tag.startsWith(lower.slice(-size))) return size;
    return 0;
  };
  const visible = (text) => {
    if (started) return text;
    const trimmed = text.replace(/^\s+/, "");
    if (trimmed) started = true;
    return trimmed;
  };
  return {
    push(chunk) {
      pending += String(chunk || "");
      let out = "";
      for (;;) {
        const lower = pending.toLowerCase();
        if (thinking) {
          const end = lower.indexOf(close);
          if (end < 0) {
            const keep = partial(pending, close);
            if (pending.length > keep) onThinking(pending.slice(0, pending.length - keep));
            pending = pending.slice(pending.length - keep);
            break;
          }
          if (end) onThinking(pending.slice(0, end));
          pending = pending.slice(end + close.length);
          thinking = false;
          continue;
        }
        const start = lower.indexOf(open);
        if (start >= 0) {
          out += pending.slice(0, start);
          pending = pending.slice(start + open.length);
          thinking = true;
          continue;
        }
        const keep = partial(pending, open);
        out += pending.slice(0, pending.length - keep);
        pending = pending.slice(pending.length - keep);
        break;
      }
      return visible(out);
    },
    flush() {
      const rest = thinking ? "" : pending;
      pending = "";
      return visible(rest);
    },
  };
}

/** Each JSON event of a server-sent event stream, until `data: [DONE]`. Comments and blank lines are skipped. */
export async function* readServerSentEvents(body) {
  const decoder = new TextDecoder();
  let buffer = "";
  let data = [];
  const dispatch = function* () {
    if (!data.length) return false;
    const payload = data.join("\n");
    data = [];
    if (payload.trim() === "[DONE]") return true;
    try {
      yield JSON.parse(payload);
    } catch {
      /* A malformed event is skipped, as browsers do. */
    }
    return false;
  };
  for await (const chunk of body) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let index;
    while ((index = buffer.search(/\r?\n/)) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + (buffer[index] === "\r" ? 2 : 1));
      if (line === "") {
        if (yield* dispatch()) return;
        continue;
      }
      if (line.startsWith(":")) continue;
      const match = /^data:\s?(.*)$/.exec(line);
      if (match) data.push(match[1]);
    }
  }
  buffer += decoder.decode();
  if (buffer.startsWith("data:")) data.push(buffer.replace(/^data:\s?/, ""));
  yield* dispatch();
}

/** One written prompt from a reply: no reasoning, fences, labels or wrapping quotes, whitespace folded. */
export function cleanPrompt(text, limit = maxPromptCharacters) {
  let body = stripThinking(text)
    .replace(/^```[a-z]*\s*([\s\S]*?)\s*```$/i, "$1")
    .trim();
  body = body.replace(/^(?:rewritten\s+)?prompt\s*:\s*/i, "").trim();
  if (/^(["“])[\s\S]*(["”])$/.test(body) && !/["“”]/.test(body.slice(1, -1)))
    body = body.slice(1, -1).trim();
  return body
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
    .slice(0, limit);
}

/** The first JSON object or array in a reply, or null. */
function replyJson(text) {
  const body = stripThinking(text)
    .replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1")
    .trim();
  const json = /[[{][\s\S]*[\]}]/.exec(body)?.[0];
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

const words = (value) =>
  String(value || "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) || [];
const stopWords = new Set([
  "a",
  "an",
  "and",
  "the",
  "of",
  "in",
  "on",
  "at",
  "with",
  "to",
  "for",
  "by",
  "from",
  "is",
  "are",
  "her",
  "his",
  "their",
  "its",
  "this",
  "that",
  "lora",
  "style",
  "v1",
  "v2",
]);
const meaningful = (value) =>
  words(value).filter((word) => word.length > 2 && !stopWords.has(word));
const one = (value, limit = 600) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
const isRole = (info) => ["acceleration", "supporting"].includes(info?.role);

/** A LoRA's suggested strength: the publisher's default, a "Strength 0.7" note, else 1. */
function suggestedStrength(info) {
  const range = strengthRange(info);
  if (range?.default !== undefined) return range.default;
  const noted = Number(
    /strength\s*:?\s*(-?\d+(?:\.\d+)?)/i.exec(`${info?.note || ""} ${info?.guidance || ""}`)?.[1],
  );
  if (Number.isFinite(noted) && noted >= -10 && noted <= 10) return noted;
  return 1;
}

/**
 * The deterministic half of LoRA matching: LoRAs that may run on the profile (never 'other', never
 * an acceleration or supporting file), scored by the request's words found in each one's title,
 * triggers and tags (description words count half), plus a small boost for LoRAs in starred results.
 * Returns at most `limit` candidates with a score above zero, best first.
 */
export function preFilterLoras({
  profile,
  prompt,
  loras = [],
  starred = [],
  limit = maxCandidates,
}) {
  const asked = new Set(meaningful(prompt));
  const boosted = new Set(starred);
  const scored = [];
  for (const { name, info = {} } of loras) {
    if (!name || isRole(info) || loraCompatibility(info, profile) === "other") continue;
    const strong = new Set([
      ...meaningful(loraName(name, info)),
      ...cleanTriggers(info.triggers).flatMap(meaningful),
      ...(info.tags || []).flatMap(meaningful),
    ]);
    const weak = new Set(meaningful(info.description).filter((word) => !strong.has(word)));
    let score = 0;
    for (const word of asked) score += strong.has(word) ? 1 : weak.has(word) ? 0.5 : 0;
    if (!score) continue;
    if (boosted.has(name)) score += 0.5;
    if (loraCompatibility(info, profile) === "fits") score += 0.25;
    scored.push({ name, info, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}

const suggestion = ({ name, info }, reason, strength = suggestedStrength(info)) => {
  const range = strengthRange(info);
  const bounded = range
    ? Math.min(range.max, Math.max(range.min, strength))
    : Math.min(4, Math.max(-4, strength));
  return {
    name,
    title: loraName(name, info),
    strength: Math.round(bounded * 100) / 100,
    triggers: cleanTriggers(info.triggers),
    reason: one(reason, 200),
  };
};

function rewriteInstructions({
  profile,
  guide,
  preset,
  references,
  vision,
  stack,
  examples,
  negative,
}) {
  const label = profile.label || profile.displayName || profile.id;
  const media = profile.kind === "video" ? "video" : "image";
  const override =
    typeof guide?.presets?.[preset.id] === "string" && guide.presets[preset.id].trim()
      ? guide.presets[preset.id].trim()
      : "";
  const triggers = stack.flatMap((item) => cleanTriggers(item.triggers));
  return [
    `You rewrite prompts for the ${media} model ${label}. Follow its prompting guide below.`,
    "Reply with the rewritten prompt only, as plain text: no preamble, labels, quotes, Markdown or notes.",
    "Keep every subject, detail, style, mood, framing and quoted text the user asked for, with quoted text kept exactly; add only what the guide recommends to realise it, never new subjects or content the user did not imply.",
    "Rewrite it properly, not as a light edit: reorder it the way the guide recommends, fix grammar and awkward wording, merge repeated ideas, and drop filler and stacked quality words (such as masterpiece, best quality, highly detailed, 8k), then apply the style below in full. The result should read clearly different from the input.",
    'Words about speed, quality tier, model, size, aspect or count (such as "turbo", "fast", "landscape", "16:9", "2K", "two images") are settings, not scene: leave them out.',
    references && vision
      ? `${references} reference image${references > 1 ? "s are" : " is"} attached: describe what the prompt needs from ${references > 1 ? "them" : "it"} into the rewrite, following the guide's editing advice.`
      : "",
    references && !vision
      ? `${references} reference image${references > 1 ? "s are" : " is"} attached to the generation but not shown to you; keep the prompt consistent with using ${references > 1 ? "them" : "it"}.`
      : "",
    triggers.length
      ? `Studio adds these LoRA trigger words when it runs, so don't add them; keep any the prompt already has exactly as written: ${[...new Set(triggers)].join(", ")}.`
      : "",
    negative ? "Describe what should be present; the negative prompt is written separately." : "",
    examples.length
      ? `Prompts this person starred on this model, for their taste (never copy their subjects): ${examples.map((example) => JSON.stringify(one(example, 400))).join(" ")}`
      : "",
    `Prompting guide: ${writerGuide(guide) || "(none; write a clear, specific natural-language prompt)"}`,
    `Style: ${override || preset.instruction}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The engine, or null while the gateway is unset. Pass `environment` as a live object (process.env)
 * so model choices saved in Settings apply at once.
 */
export function createAssistant(
  environment = process.env,
  {
    fetchImpl = fetch,
    // Reasoning models think for tens of seconds before a reply, streamed or not.
    timeoutMs = 90_000,
    log = console,
    now = Date.now,
    resolveSettings = () => assistantSettings(environment),
    // The running local text model's route (runtime/services.ts); none without a runtime.
    localText = async () => null,
  } = {},
) {
  if (!resolveSettings()) return null;
  const lookups = new Map();
  const settings = () => {
    const resolved = resolveSettings();
    if (!resolved)
      throw new AssistantError("The prompt assistant is not configured.", { status: 503 });
    return resolved;
  };

  /** Local while a local text workload runs (reading images as it says), otherwise the cloud, which always does. */
  async function route() {
    return (await localText()) || { prefix: settings().cloud, vision: true };
  }

  /** The Bifrost model a call asks for: its route and `textLevels` level, or the administrator's choice. */
  async function modelFor(call) {
    const { chosen } = settings();
    if (chosen && call !== "writer") return chosen;
    return `${(await route()).prefix}${textLevels[call]}`;
  }

  /** Whether the route the calls take reads images. */
  async function supportsVision() {
    return (await route()).vision;
  }

  /** A cached GET against the gateway's root, or `fallback` (cached briefly) when it fails. */
  async function lookup(key, path, read, fallback) {
    const cached = lookups.get(key);
    if (cached && cached.until > now()) return cached.value;
    const { root, key: token } = settings();
    let value = fallback;
    let ok = false;
    try {
      const response = await fetchImpl(`${root}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        value = read(await response.json());
        ok = true;
      } else await response.body?.cancel?.();
    } catch {
      /* Unreachable or not OpenAI-compatible: treated as unknown. */
    }
    lookups.set(key, { value, until: now() + (ok ? lookupTtlMs : failedLookupTtlMs) });
    return value;
  }

  /** The gateway's model names, for Settings; empty when it can't be asked. */
  async function listModelDetails() {
    return lookup(
      "models",
      "/v1/models",
      (answer) =>
        [
          ...new Set(
            (Array.isArray(answer?.data) ? answer.data : [])
              .map((item) => String(item?.id || ""))
              .filter(Boolean),
          ),
        ]
          .sort((a, b) => a.localeCompare(b))
          .map((id) => {
            const item = answer.data.find((entry) => String(entry?.id || "") === id);
            const provider =
              typeof item.provider === "string"
                ? item.provider
                : typeof item.owned_by === "string"
                  ? item.owned_by
                  : "";
            return {
              id,
              label: typeof item.name === "string" ? item.name : id,
              ...(provider ? { provider } : {}),
            };
          }),
      [],
    );
  }

  async function listModels() {
    return (await listModelDetails()).map((model) => model.id);
  }

  /**
   * One chat completion. With `onDelta` or `onThinking`, it streams: visible text (reasoning
   * stripped) goes to `onDelta` and reasoning (`reasoning_content` deltas and `<think>` blocks) to
   * `onThinking` as they arrive; a gateway that answers without streaming hands over each at once.
   * Resolves to { text, thinking, model, ms } with the final, reasoning-free text; throws AssistantError.
   */
  async function chat({
    model,
    messages,
    temperature = 0.7,
    // Reasoning models spend part of this on thinking before the reply.
    maxTokens = 4000,
    signal,
    onDelta,
    onThinking,
    timeout: ms,
  } = {}) {
    const { endpoint, key } = settings();
    const started = now();
    const stream = typeof onDelta === "function" || typeof onThinking === "function";
    const shown = typeof onDelta === "function" ? onDelta : () => {};
    let reasoning = "";
    let source = "";
    // Reasoning from `reasoning_content` and from `<think>` blocks reads as separate paragraphs.
    const thought = (piece, from = "think") => {
      const text = `${reasoning && from !== source ? "\n\n" : ""}${piece}`;
      source = from;
      reasoning += text;
      onThinking?.(text);
    };
    const timer = AbortSignal.timeout(ms ?? timeoutMs);
    // The model name carries the reasoning level (`textLevels`); Bifrost applies it.
    const body = { model, messages, temperature, max_tokens: maxTokens, stream };
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Accept: stream ? "text/event-stream" : "application/json",
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, timer]) : timer,
      });
    } catch (error) {
      if (signal?.aborted) throw new AssistantError("cancelled", { status: 499, cause: error });
      throw new AssistantError(timer.aborted ? "timeout" : "unreachable", {
        status: timer.aborted ? 504 : 502,
        cause: error,
      });
    }
    if (!response.ok) {
      await response.body?.cancel?.().catch(() => {});
      throw new AssistantError(`HTTP ${response.status}`, {
        status: response.status === 429 ? 429 : 502,
      });
    }
    let raw = "";
    let finish = "";
    try {
      if (
        stream &&
        /text\/event-stream/i.test(response.headers.get("content-type") || "") &&
        response.body
      ) {
        const filter = createThinkFilter(thought);
        for await (const event of readServerSentEvents(response.body)) {
          if (event?.error)
            throw new AssistantError(one(event.error.message || "stream error", 120));
          const choice = event?.choices?.[0];
          if (choice?.finish_reason) finish = choice.finish_reason;
          const part = choice?.delta || choice?.message;
          if (typeof part?.reasoning_content === "string" && part.reasoning_content)
            thought(part.reasoning_content, "reasoning");
          const piece = typeof part?.content === "string" ? part.content : "";
          if (!piece) continue;
          raw += piece;
          const visible = filter.push(piece);
          if (visible) shown(visible);
        }
        const rest = filter.flush();
        if (rest) shown(rest);
      } else {
        const choice = (await response.json())?.choices?.[0];
        const message = choice?.message;
        finish = String(choice?.finish_reason || "");
        raw = String(message?.content || "");
        const reasoned = String(message?.reasoning_content || "").trim();
        if (reasoned) thought(reasoned, "reasoning");
        if (replyThinking(raw)) thought(replyThinking(raw));
        if (stripThinking(raw)) shown(stripThinking(raw));
      }
    } catch (error) {
      if (error instanceof AssistantError) throw error;
      if (signal?.aborted) throw new AssistantError("cancelled", { status: 499, cause: error });
      throw new AssistantError(timer.aborted ? "timeout" : "unusable reply", {
        status: timer.aborted ? 504 : 502,
        cause: error,
      });
    }
    if (!stripThinking(raw))
      throw new AssistantError(
        finish === "length" ? "reply cut off at the token limit" : "empty reply",
      );
    return {
      text: stripThinking(raw),
      thinking: reasoning.trim(),
      raw,
      model,
      ms: now() - started,
    };
  }

  const note = (operation, profile, started, reason = "") => {
    const what = `Prompt assistant ${operation}${profile?.id ? ` for ${profile.id}` : ""}`;
    if (reason) log.warn?.(`${what} fell back after ${now() - started} ms: ${reason}`);
    else log.info?.(`${what} in ${now() - started} ms`);
  };
  const failure = (error) => (error instanceof AssistantError ? error.reason : "unusable reply");
  const rethrowCancel = (error) => {
    if (error instanceof AssistantError && error.reason === "cancelled") throw error;
  };

  /**
   * Rewrites a prompt with a preset, streaming through `onDelta`. References are read only by a
   * vision model; otherwise the rewrite is text-only and says so (referencesRead: false).
   * FLUX.3's Enhance uses the maker's upsampler prompt verbatim. On failure the original prompt
   * comes back with source "fallback" and the reason.
   */
  async function rewrite({
    profile = {},
    guide = null,
    prompt,
    preset: presetId = defaultPreset,
    references = [],
    stack = [],
    examples = [],
    negative = false,
    signal,
    onDelta,
  } = {}) {
    const preset = assistantPreset(presetId);
    if (!preset) throw new AssistantError("Choose a known preset.", { status: 400 });
    const original = String(prompt || "")
      .trim()
      .slice(0, maxPromptCharacters);
    if (!original) throw new AssistantError("Enter a prompt to rewrite.", { status: 400 });
    const model = await modelFor("rewrite");
    const started = now();
    const images = Array.isArray(references) ? references.filter((image) => image?.data) : [];
    const vision = images.length ? await supportsVision() : false;
    const upsampler = preset.id === "enhance" ? familyUpsampler(profile) : null;
    let system;
    let user = original;
    if (upsampler) {
      const edit = images.length > 0 && vision;
      system = edit ? upsampler.edit : upsampler.text;
      if (edit)
        user = `Reference images follow in order (the first image, the second image, ...).\nUser request: ${original}\nOutput the caption.`;
    } else
      system = rewriteInstructions({
        profile,
        guide,
        preset,
        references: images.length,
        vision,
        stack,
        examples: examples.slice(0, maxExamples),
        negative,
      });
    const base = { preset: preset.id, model, vision, referencesRead: vision && images.length > 0 };
    try {
      const reply = await chat({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent(user, images, vision) },
        ],
        temperature: upsampler ? 0.3 : 0.7,
        signal,
        onDelta,
      });
      const written = cleanPrompt(reply.text);
      if (!written) throw new AssistantError("unusable reply");
      note("rewrite", profile, started);
      return { ...base, prompt: written, source: "assistant", ms: now() - started };
    } catch (error) {
      rethrowCancel(error);
      note("rewrite", profile, started, failure(error));
      return {
        ...base,
        prompt: original,
        source: "fallback",
        reason: failure(error),
        ms: now() - started,
      };
    }
  }

  /**
   * A negative prompt, or { negative: null, unused: true } when the profile takes none (its guide's
   * negative.effect is "none", or it has no negative input). The fallback is the guide's default.
   */
  async function negative({
    profile = {},
    guide = null,
    prompt,
    cfg,
    stack = [],
    infos = {},
    signal,
  } = {}) {
    if (negativeUnused(guide) || profile?.capabilities?.negativePrompt === false)
      return { negative: null, unused: true, source: "guide" };
    const started = now();
    const fallback =
      recommendedNegative(guide, { cfg: cfg ?? 2, stack, infos }) ||
      String(guide?.negative?.default || "").trim();
    const model = await modelFor("negative");
    const system = [
      `You write negative prompts for the ${profile.kind === "video" ? "video" : "image"} model ${profile.label || profile.id || "in use"}.`,
      "Reply with the negative prompt only: a short comma-separated list of unwanted traits (artefacts, defects, styles to avoid), at most 40 words, no preamble.",
      "Never list anything the positive prompt asks for, and never add subjects.",
      guide?.negative ? `The guide's negative advice: ${JSON.stringify(guide.negative)}` : "",
      `Prompting guide: ${writerGuide(guide) || "(none)"}`,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      const reply = await chat({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Positive prompt: ${one(prompt, maxPromptCharacters)}` },
        ],
        temperature: 0.3,
        signal,
      });
      const written = cleanPrompt(reply.text, 600).replace(/^negative(?: prompt)?\s*:\s*/i, "");
      if (!written) throw new AssistantError("unusable reply");
      note("negative", profile, started);
      return { negative: written, unused: false, source: "assistant", model, ms: now() - started };
    } catch (error) {
      rethrowCancel(error);
      note("negative", profile, started, failure(error));
      return {
        negative: fallback,
        unused: false,
        source: "fallback",
        reason: failure(error),
        model,
        ms: now() - started,
      };
    }
  }

  /**
   * LoRA suggestions for a prompt: the deterministic pre-filter, ranked by the model as JSON (at
   * most `limit`, only from the candidates). Without candidates there is no call; without a usable
   * reply the pre-filter's best come back.
   */
  async function matchLoras({
    profile = {},
    prompt,
    loras = [],
    starred = [],
    limit = 4,
    signal,
  } = {}) {
    const candidates = preFilterLoras({ profile, prompt, loras, starred });
    if (!candidates.length) return { loras: [], source: "prefilter" };
    const started = now();
    const model = await modelFor("loras");
    const listed = candidates.map(({ name, info }) => ({
      name,
      title: loraName(name, info),
      triggers: cleanTriggers(info.triggers),
      tags: (info.tags || []).slice(0, 10),
      about: one(info.description, 200),
      strength: strengthRange(info) || undefined,
    }));
    const system = [
      `You choose LoRAs (style and subject adapters) for the model ${profile.label || profile.id || "in use"}.`,
      `From the candidates only, pick at most ${limit} that clearly help the prompt; none is fine. Reply with JSON only: {"loras": [{"name": "...", "strength": 0.8, "reason": "short reason"}]}, best first.`,
      "Strengths stay within a candidate's range when it has one; otherwise use 0.6 to 1.",
      `Candidates: ${JSON.stringify(listed)}`,
    ].join("\n");
    const byName = new Map(candidates.map((item) => [item.name, item]));
    try {
      const reply = await chat({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Prompt: ${one(prompt, maxPromptCharacters)}` },
        ],
        temperature: 0.2,
        signal,
      });
      const parsed = replyJson(reply.text);
      const picked = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.loras)
          ? parsed.loras
          : null;
      if (!picked) throw new AssistantError("unusable reply");
      const result = [];
      for (const item of picked) {
        const found = byName.get(String(item?.name || ""));
        if (!found || result.some((entry) => entry.name === found.name)) continue;
        const strength = Number(item.strength);
        result.push(
          suggestion(
            found,
            item.reason || "Fits the prompt",
            Number.isFinite(strength) ? strength : suggestedStrength(found.info),
          ),
        );
        if (result.length >= limit) break;
      }
      note("LoRA match", profile, started);
      return { loras: result, source: "assistant", model, ms: now() - started };
    } catch (error) {
      rethrowCancel(error);
      note("LoRA match", profile, started, failure(error));
      return {
        loras: candidates
          .slice(0, limit)
          .map((item) => suggestion(item, "Matches words in your prompt")),
        source: "prefilter",
        reason: failure(error),
        ms: now() - started,
      };
    }
  }

  /**
   * A prompt from an image: with a vision model it is read, along with a negative, the best of the
   * offered profiles and LoRAs. Without vision, a `hint` (a caption or file name) is written up as
   * text only (vision: false); with no hint it is unavailable, with the reason.
   */
  async function describe({
    images = [],
    hint = "",
    profile = {},
    guide = null,
    profiles = [],
    loras = [],
    signal,
  } = {}) {
    const model = await modelFor("describe");
    const started = now();
    const pictures = images.filter((image) => image?.data);
    const vision = pictures.length ? await supportsVision() : false;
    if (!vision && !String(hint).trim())
      return {
        available: false,
        vision: false,
        model,
        reason: pictures.length
          ? "The running text model can’t read images."
          : "Add an image to describe.",
      };
    const system = [
      vision
        ? "Describe the attached image as a prompt that would recreate it."
        : "Write a prompt from this description of an image; you cannot see the image itself.",
      profile?.id
        ? `Write it for the ${profile.kind === "video" ? "video" : "image"} model ${profile.label || profile.id}, following its guide: ${writerGuide(guide) || "(none)"}`
        : "Write clear, specific natural language.",
      `Reply with JSON only: {"prompt": "...", "negative": "..." or "", "profile": one of ${JSON.stringify(profiles.map((item) => item.id).slice(0, 40))} or "", "loras": names from ${JSON.stringify(loras.map((item) => item.name).slice(0, 40))}}.`,
    ].join("\n");
    try {
      const text = vision ? "Describe this image." : `Description: ${one(hint, 2000)}`;
      const reply = await chat({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent(text, pictures, vision) },
        ],
        temperature: 0.4,
        signal,
      });
      const parsed = replyJson(reply.text);
      const written = cleanPrompt(
        typeof parsed?.prompt === "string" ? parsed.prompt : parsed ? "" : reply.text,
      );
      if (!written) throw new AssistantError("unusable reply");
      const known = new Set(loras.map((item) => item.name));
      note("describe", profile, started);
      return {
        available: true,
        vision,
        model,
        prompt: written,
        negative: typeof parsed?.negative === "string" ? cleanPrompt(parsed.negative, 600) : "",
        profileId: profiles.some((item) => item.id === parsed?.profile) ? parsed.profile : "",
        loras: (Array.isArray(parsed?.loras) ? parsed.loras : [])
          .map(String)
          .filter((name) => known.has(name))
          .slice(0, 6),
        ms: now() - started,
      };
    } catch (error) {
      rethrowCancel(error);
      note("describe", profile, started, failure(error));
      throw error instanceof AssistantError ? error : new AssistantError(failure(error));
    }
  }

  /**
   * A factual description of what an image shows and short search tags, for gallery search
   * (domain/captions.ts). The caller checks the model reads images. A reply that isn't the asked-for
   * JSON is kept as plain text without tags; the text is cut to `captionCharacters`.
   */
  async function caption({ image, signal } = {}) {
    const model = await modelFor("caption");
    const reply = await chat({
      model,
      messages: [
        { role: "system", content: captionInstructions },
        { role: "user", content: userContent("Caption this image.", [image], true) },
      ],
      temperature: 0.2,
      signal,
    });
    const parsed = replyJson(reply.text);
    const text = one(
      typeof parsed?.text === "string" ? parsed.text : reply.text,
      captionCharacters,
    );
    if (!text) throw new AssistantError("unusable reply");
    const tags = [
      ...new Set(
        (Array.isArray(parsed?.tags) ? parsed.tags : [])
          .filter((tag) => typeof tag === "string")
          .map((tag) => one(tag.toLowerCase(), 40))
          .filter(Boolean),
      ),
    ].slice(0, captionTags);
    return { text, tags, model };
  }

  /** A gallery item's title of a few words, summarised from its prompt; throws on an unusable reply. */
  async function title({ prompt, signal } = {}) {
    const model = await modelFor("title");
    const reply = await chat({
      model,
      messages: [
        { role: "system", content: titleInstructions },
        { role: "user", content: one(prompt, maxPromptCharacters) },
      ],
      temperature: 0.2,
      signal,
    });
    const text = replyTitle(reply.text);
    if (!text) throw new AssistantError("unusable reply");
    return { title: text, model };
  }

  /**
   * A drafted prompting guide in the prompting.json pack schema, from a source page's text and the
   * nearest existing pack. Throws when the reply isn't a usable pack; callers mark it AI-drafted.
   */
  async function draftGuide({
    profile = {},
    family = "",
    sourceText = "",
    nearest = null,
    signal,
  } = {}) {
    const model = await modelFor("guide");
    const started = now();
    const system = [
      `You write prompting guides for the ${profile.kind === "video" ? "video" : "image"} model ${profile.label || profile.id || family}${family ? ` (family ${family})` : ""}.`,
      'Reply with JSON only, a pack with: "name", "summary" (one sentence), "patterns" (list), "rules" (list), "sampling" (object of recommended settings), "pitfalls" (list), "example" (one prompt), "negative" ({"effect": "recommended"|"optional"|"none", "default": "..."}).',
      "Use only what the source says or what the nearest guide establishes for this family; never invent settings.",
      nearest ? `Nearest existing guide: ${writerGuide(nearest)}` : "",
      `Source page: ${one(sourceText, 12000)}`,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      const reply = await chat({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: "Draft the guide." },
        ],
        temperature: 0.3,
        signal,
      });
      const guide = validDraftGuide(replyJson(reply.text));
      if (!guide) throw new AssistantError("unusable reply");
      note("guide draft", profile, started);
      return { guide, aiDrafted: true, model, ms: now() - started };
    } catch (error) {
      rethrowCancel(error);
      note("guide draft", profile, started, failure(error));
      throw error instanceof AssistantError ? error : new AssistantError(failure(error));
    }
  }

  /**
   * A drafted runtime profile (workflow JSON with a studio block) from a family template: the graph is the
   * template's, the model file replaces the template's, and only the name, description, uncensored marker
   * and recommended steps, CFG, sampler and scheduler come from the source page (read by the model,
   * else `recommended`). The caller checks it with validateProfileText before saving.
   */
  async function draftProfile({
    id,
    template,
    modelFile,
    recommended = {},
    sourceText = "",
    uncensored,
    signal,
  } = {}) {
    if (!template || typeof template !== "object" || !template.studio || !template.graph)
      throw new AssistantError("Choose a family template with a studio block and a graph.", {
        status: 400,
      });
    let read = {};
    let source = "template";
    const started = now();
    if (String(sourceText).trim()) {
      const system =
        'From the model page below, reply with JSON only: {"name": "...", "description": "one sentence", "uncensored": true|false|null, "steps": n|null, "cfg": n|null, "sampler": "..."|null, "scheduler": "..."|null}. Use only what the page states.';
      try {
        const reply = await chat({
          model: await modelFor("profile"),
          messages: [
            { role: "system", content: system },
            { role: "user", content: one(sourceText, 12000) },
          ],
          temperature: 0.1,
          signal,
        });
        read = replyJson(reply.text) || {};
        source = "assistant";
        note("profile draft", { id }, started);
      } catch (error) {
        rethrowCancel(error);
        note("profile draft", { id }, started, failure(error));
      }
    }
    return {
      profile: draftedProfile({ id, template, modelFile, recommended, read, uncensored }),
      aiDrafted: true,
      source,
    };
  }

  return {
    settings,
    model: modelFor,
    supportsVision,
    listModels,
    listModelDetails,
    chat,
    rewrite,
    negative,
    matchLoras,
    describe,
    caption,
    title,
    draftGuide,
    draftProfile,
  };
}

/** A drafted guide reduced to the pack schema, or null without a summary. */
export function validDraftGuide(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.summary !== "string" ||
    !value.summary.trim()
  )
    return null;
  const list = (items) =>
    (Array.isArray(items) ? items : [])
      .filter((item) => typeof item === "string" && item.trim())
      .map((item) => item.trim().slice(0, 1000))
      .slice(0, 20);
  const negative =
    value.negative &&
    typeof value.negative === "object" &&
    ["recommended", "optional", "none"].includes(value.negative.effect)
      ? {
          effect: value.negative.effect,
          ...(typeof value.negative.default === "string" && value.negative.effect !== "none"
            ? { default: value.negative.default.trim().slice(0, 500) }
            : {}),
        }
      : null;
  const sampling =
    value.sampling && typeof value.sampling === "object" && !Array.isArray(value.sampling)
      ? Object.fromEntries(
          Object.entries(value.sampling)
            .filter(([, item]) => ["string", "number", "boolean"].includes(typeof item))
            .slice(0, 20),
        )
      : null;
  return {
    ...(typeof value.name === "string" && value.name.trim()
      ? { name: value.name.trim().slice(0, 120) }
      : {}),
    summary: value.summary.trim().slice(0, 600),
    patterns: list(value.patterns),
    rules: list(value.rules),
    ...(sampling && Object.keys(sampling).length ? { sampling } : {}),
    pitfalls: list(value.pitfalls),
    ...(typeof value.example === "string" && value.example.trim()
      ? { example: value.example.trim().slice(0, 2000) }
      : {}),
    ...(negative ? { negative } : {}),
  };
}

/**
 * The template with the model file, recommended settings and page details in place. Pure.
 */
export function draftedProfile({
  id,
  template,
  modelFile,
  recommended = {},
  read = {},
  uncensored,
}) {
  const profile = structuredClone(template);
  const meta = profile.studio;
  const previousModel = meta.defaults?.model;
  if (id) meta.id = id;
  if (typeof read.name === "string" && read.name.trim()) meta.name = read.name.trim().slice(0, 120);
  if (typeof read.description === "string" && read.description.trim())
    meta.description = read.description.trim().slice(0, 300);
  meta.defaults = { ...(meta.defaults || {}) };
  if (modelFile) {
    meta.defaults.model = modelFile;
    // Loader inputs that named the template's file now name this one.
    for (const node of Object.values(profile.graph || {}))
      for (const [key, value] of Object.entries(node?.inputs || {}))
        if (previousModel && value === previousModel) node.inputs[key] = modelFile;
  }
  const number = (value, min, max) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : undefined;
  };
  const steps = number(read.steps ?? recommended.steps, 1, 200);
  const cfg = number(read.cfg ?? recommended.cfg, 0, 30);
  if (steps !== undefined) meta.defaults.steps = Math.round(steps);
  if (cfg !== undefined) meta.defaults.cfg = cfg;
  for (const key of ["sampler", "scheduler"]) {
    const value = read[key] ?? recommended[key];
    if (typeof value === "string" && /^[a-z0-9_+.-]{1,60}$/i.test(value))
      meta.defaults[key] = value;
  }
  // Unknown counts as uncensored until an administrator says otherwise.
  meta.uncensored =
    typeof uncensored === "boolean"
      ? uncensored
      : typeof read.uncensored === "boolean"
        ? read.uncensored
        : true;
  return profile;
}
