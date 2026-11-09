// The prompt assistant's MCP tools: rewrite_prompt, suggest_negative and suggest_loras. Each one calls
// Studio's own /api/assistant routes with the account's credential, so the chat and the composer
// share one engine and one set of rules (Prompt Assistant, Uncensored Models for Spicy, LoRAs, the
// account's profiles). What the chat used is remembered for six hours, on disk (mcp-assistant.json
// beside MCP's ownership file), so a generate with that prompt records it on the result
// (`assistant`, source "chat") for Details and Recreate, even across a restart.
import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../json-store.js";
import { assistantPresets, defaultPreset } from "../assistant-presets.js";
import { mcpJson } from "./media.js";
import { maxPromptCharacters } from "../../shared/queue.ts";

const maxRemembered = 512;
const rememberMs = 6 * 60 * 60 * 1000;
const maxReferences = 4;
const key = (owner, prompt) =>
  JSON.stringify([
    owner || "",
    String(prompt || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase(),
  ]);

/**
 * What each owner's chat recently had written or suggested, for the generation record. With `file`,
 * it is kept there (owners are account ids or MCP's keyed hashes; prompts are already in the results).
 */
export function createChatAssistantMemory({ now = Date.now, file = "", log = console } = {}) {
  const rewrites = new Map();
  const suggested = new Map();
  const fresh = (entry) => (entry && now() - entry.at < rememberMs ? entry : null);
  if (file) {
    try {
      const saved = readJsonFile(file);
      for (const [map, entries] of [
        [rewrites, saved?.rewrites],
        [suggested, saved?.suggested],
      ]) {
        for (const [id, value] of Array.isArray(entries) ? entries.slice(-maxRemembered) : [])
          if (typeof id === "string" && fresh(value)) map.set(id, value);
      }
    } catch (error) {
      if (error.code !== "ENOENT")
        log.warn?.(
          `[mcp] The chat assistant records couldn’t be read; starting afresh: ${error.message}`,
        );
    }
  }
  const save = () => {
    if (!file) return;
    try {
      writeJsonFile(
        file,
        {
          version: 1,
          rewrites: [...rewrites].filter(([, value]) => fresh(value)),
          suggested: [...suggested].filter(([, value]) => fresh(value)),
        },
        { mode: 0o600 },
      );
    } catch (error) {
      log.warn?.(`[mcp] The chat assistant records couldn’t be saved: ${error.message}`);
    }
  };
  const keep = (map, id, value) => {
    map.delete(id);
    if (map.size >= maxRemembered) map.delete(map.keys().next().value);
    map.set(id, { ...value, at: now() });
    save();
  };
  return {
    rewrote(owner, prompt, { preset, model }) {
      keep(rewrites, key(owner, prompt), { preset, ...(model ? { model } : {}) });
    },
    suggested(owner, names) {
      keep(suggested, owner || "", {
        names: [...new Set([...(fresh(suggested.get(owner || ""))?.names || []), ...names])].slice(
          -32,
        ),
      });
    },
    /** The `assistant` record for a run of these prompts with this stack, or null when the chat wrote none of them. */
    record(owner, prompts = [], loras = []) {
      const written = prompts
        .map((prompt) => fresh(rewrites.get(key(owner, prompt))))
        .find(Boolean);
      if (!written) return null;
      const offered = new Set(fresh(suggested.get(owner || ""))?.names || []);
      const chosen = loras.map((item) => item?.name).filter((name) => name && offered.has(name));
      return {
        preset: written.preset,
        ...(written.model ? { model: written.model } : {}),
        source: "chat",
        ...(chosen.length ? { lorasSuggested: [...new Set(chosen)] } : {}),
      };
    },
  };
}

/**
 * Registers the three tools. `tool` is mcp.js's registration helper, `profileOf(name)` resolves a
 * profile id or name the way generate does, and `memory` is createChatAssistantMemory's.
 */
export function registerAssistantTools({ tool, server, media, owner, profileOf, memory }) {
  // Custom is the UI's free-text instruction; the chat restyles with its own words instead.
  const presetIds = assistantPresets.filter((preset) => !preset.custom).map((preset) => preset.id);
  const prompt = z.string().trim().min(1).max(maxPromptCharacters);
  const profileId = z
    .string()
    .min(1)
    .describe("The profile the prompt is for: an id or name from models.");
  const ask = (route, body, signal) =>
    media.request("POST", `/api/assistant/${route}`, body, owner, { signal });
  /** A reference the account uploaded, as the data URL the assistant reads (a vision model only). */
  const reference = async (value, signal) => {
    const id = media.referenceId(value);
    media.own(owner, id, "assets");
    const { content, mime } = await media.call(
      "GET",
      `/api/reference-assets/${encodeURIComponent(id)}/media`,
      undefined,
      owner,
      { signal },
    );
    return `data:${mime};base64,${content.toString("base64")}`;
  };

  tool(
    server,
    "rewrite_prompt",
    "rewrite prompt",
    `Rewrite a prompt for a profile with a preset (${presetIds.join(", ")}; spicy needs Uncensored Models, which models lists among the account's features), the way Studio's magic button does. Only when the user asks to improve, rewrite or restyle a prompt; generate already writes prompts from requests. A vision model reads reference_asset_ids from upload. Show the result; pass it to generate in prompts.`,
    {
      prompt,
      profile_id: profileId,
      // A free string checked here, so a preset this deployment doesn't have gets the current list.
      preset: z
        .string()
        .trim()
        .toLowerCase()
        .refine((value) => presetIds.includes(value), {
          message: `Use one of ${presetIds.join(", ")}`,
        })
        .default(defaultPreset),
      reference_asset_ids: z.array(z.string().min(1)).max(maxReferences).optional(),
    },
    async ({ prompt: text, profile_id, preset, reference_asset_ids = [] }, signal) => {
      const profile = await profileOf(profile_id);
      const references = await Promise.all(reference_asset_ids.map((id) => reference(id, signal)));
      const written = await ask(
        "rewrite",
        { profileId: profile.id, prompt: text, preset, references },
        signal,
      );
      if (written.source === "fallback")
        return mcpJson({
          prompt: text,
          preset,
          unchanged: true,
          reason: `The assistant couldn’t rewrite it (${written.reason || "unavailable"}); the prompt is unchanged.`,
        });
      memory.rewrote(owner, written.prompt, { preset: written.preset, model: written.model });
      return mcpJson({
        prompt: written.prompt,
        preset: written.preset,
        model: written.model,
        profile_id: profile.id,
        ...(references.length ? { references_read: Boolean(written.referencesRead) } : {}),
      });
    },
    { readOnlyHint: true },
  );

  tool(
    server,
    "suggest_negative",
    "suggest negative",
    "Write a negative prompt for a prompt and profile, only when asked. Returns unused: true when the profile takes none; then pass no negative_prompt.",
    {
      prompt,
      profile_id: profileId,
    },
    async ({ prompt: text, profile_id }, signal) => {
      const profile = await profileOf(profile_id);
      const written = await ask("negative", { profileId: profile.id, prompt: text }, signal);
      return mcpJson(written.unused ? { unused: true } : { negative: written.negative });
    },
    { readOnlyHint: true },
  );

  tool(
    server,
    "suggest_loras",
    "suggest loras",
    "Suggest LoRAs from the profile’s library for a prompt, only when asked: name, title, strength, triggers and a reason. Pass chosen ones to generate as loras; Studio adds their triggers.",
    {
      prompt,
      profile_id: profileId,
    },
    async ({ prompt: text, profile_id }, signal) => {
      const profile = await profileOf(profile_id);
      const { loras = [] } = await ask("loras", { profileId: profile.id, prompt: text }, signal);
      memory.suggested(
        owner,
        loras.map((item) => item.name),
      );
      return mcpJson({
        profile_id: profile.id,
        loras: loras.map(({ name, title, strength, triggers, reason }) => ({
          name,
          title,
          strength,
          triggers,
          reason,
        })),
      });
    },
    { readOnlyHint: true },
  );
}
