// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The prompt assistant's routes. Every route is account-scoped: it needs the Prompt Assistant
 * access-profile feature, works only with profiles the account may use, and Spicy needs NSFW Models.
 * LoRA suggestions need the LoRAs feature.
 *
 *   GET  /api/assistant                 what this account may use: presets, models, vision, and the
 *                                       profiles whose guide takes no negative (noNegative)
 *   POST /api/assistant/rewrite         { profileId, prompt, preset, references?, loras? } → streamed
 *                                       (text/event-stream: delta, done, error) or JSON
 *   POST /api/assistant/negative        { profileId, prompt, cfg?, loras? } → { negative | null, unused }
 *   POST /api/assistant/loras           { profileId, prompt } → { loras: [{ name, title, strength, triggers, reason }] }
 */
import {
  AssistantError,
  assistantModelKey,
  assistantSettings,
  assistantSpicyModelKey,
  createAssistant,
  spicyModelOf,
} from "./assistant.js";
import { assistantPresets, defaultPreset } from "./assistant-presets.js";
import { mayUseFeature } from "./account-policy.js";
import { loadSharp } from "./sharp-loader.js";

const maxReferences = 4;
const maxImageBytes = 12 * 1024 * 1024;
const referenceEdge = 1024;
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;

export const assistantSettingKeys = Object.freeze([assistantModelKey, assistantSpicyModelKey]);

/** Whether an account (or single-user Studio, with no account) has a feature. */
const allowed = (req, feature) => !req.studioAccount || mayUseFeature(req.studioAccount, feature);

const disconnectSignal = (res) => {
  const controller = new AbortController();
  res.once("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
};

/** A pasted image as { mime, data } (base64), or null. */
export function imageFromDataUrl(value) {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/.exec(
    String(value || ""),
  );
  if (!match) return null;
  const data = match[2].replace(/\s+/g, "");
  if (Math.floor((data.length * 3) / 4) > maxImageBytes) return null;
  return { mime: match[1], data };
}

/** References downscaled (longest edge 1024 px, JPEG) so a vision call stays small; unresized without sharp. */
export async function downscaleReferences(values) {
  const images = (Array.isArray(values) ? values : [])
    .slice(0, maxReferences)
    .map(imageFromDataUrl)
    .filter(Boolean);
  const sharp = images.length ? await loadSharp() : null;
  if (!sharp) return images;
  return Promise.all(
    images.map(async (image) => {
      try {
        const data = await sharp(Buffer.from(image.data, "base64"))
          .rotate()
          .resize({
            width: referenceEdge,
            height: referenceEdge,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: 85 })
          .toBuffer();
        return { mime: "image/jpeg", data: data.toString("base64") };
      } catch {
        return image;
      }
    }),
  );
}

/**
 * What a generation records about the assistant (gallery items' `assistant`): the preset, the model,
 * where it ran (`ui` or `chat`) and the suggested LoRAs that were chosen, only those in the run's
 * stack. Anything malformed records nothing.
 */
export function assistantRecord(value, loras = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const preset = assistantPresets.find((item) => item.id === value.preset)?.id;
  if (!preset) return null;
  const model = String(value.model || "").trim();
  const stacked = new Set(
    (Array.isArray(loras) ? loras : [])
      .filter((item) => item && item.enabled !== false)
      .map((item) => String(item.name || "")),
  );
  const chosen = [
    ...new Set(
      (Array.isArray(value.lorasSuggested) ? value.lorasSuggested : [])
        .map((name) => String(name || ""))
        .filter((name) => stacked.has(name)),
    ),
  ].slice(0, 8);
  return {
    preset,
    ...(modelPattern.test(model) ? { model } : {}),
    source: value.source === "chat" ? "chat" : "ui",
    ...(chosen.length ? { lorasSuggested: chosen } : {}),
  };
}

/** Settings › Models › Integrations: the assistant's gateway, chosen models and vision. */
export async function assistantIntegration({ environment = process.env, engine, source }) {
  let settings = null;
  let problem = "";
  try {
    settings = assistantSettings(environment);
  } catch (error) {
    problem = error.message;
  }
  const row = (key, effective) => ({
    key,
    configured: String(environment[key] || "").trim(),
    effective,
    ...source(key),
  });
  if (!settings || !engine)
    return {
      available: false,
      note: problem || "Set STUDIO_PROMPT_WRITER_URL, _KEY and _MODEL to use the prompt assistant.",
      models: [],
      model: row(assistantModelKey, ""),
      spicy: row(assistantSpicyModelKey, ""),
      writerModel: "",
    };
  const [models, vision] = await Promise.all([engine.listModels(), engine.supportsVision()]);
  return {
    available: true,
    writerModel: settings.writerModel,
    models,
    model: { ...row(assistantModelKey, settings.model), vision },
    spicy: {
      ...row(assistantSpicyModelKey, settings.spicyModel),
      vision: Boolean(settings.spicyModel) && vision,
    },
  };
}

/** Checks a model name for the two assistant settings; '' clears it. */
export function assistantSettingValue(key, value) {
  if (!assistantSettingKeys.includes(key)) throw new Error("That setting cannot be changed here.");
  const model = String(value ?? "").trim();
  if (model && !modelPattern.test(model)) throw new Error("Choose a valid model name.");
  return model;
}

/**
 * `profiles(req)`: the generation profiles this account may use (account-scoped). `guide(profile)`:
 * its detailed prompting guide. `loras(req)`: [{ name, info }] the account may stack. `starred(req,
 * profile)`: { examples, loras } from starred results on the same family.
 */
export function registerAssistantRoutes(
  app,
  {
    environment = process.env,
    fetchImpl = fetch,
    supportsVision,
    engine = createAssistant(environment, { fetchImpl, supportsVision }),
    profiles = async () => [],
    guide = () => null,
    loras = async () => [],
    starred = async () => ({ examples: [], loras: [] }),
  } = {},
) {
  const fail = (res, error) => {
    const status = error instanceof AssistantError ? error.status : Number(error?.status) || 400;
    res.status(status >= 400 && status < 600 ? status : 502).json({
      ok: false,
      error:
        error instanceof AssistantError && error.status >= 500
          ? `The prompt assistant is unavailable (${error.reason}).`
          : error.message,
    });
  };
  /** The engine and the account's profile, or an answer explaining why not. */
  const ready = async (req, res, { profileRequired = true } = {}) => {
    res.setHeader("Cache-Control", "no-store");
    if (!engine) {
      res.status(503).json({ ok: false, error: "The prompt assistant is not configured." });
      return null;
    }
    if (!allowed(req, "promptAssistant")) {
      res.status(403).json({ ok: false, error: "The prompt assistant is off for this account." });
      return null;
    }
    const id = String(req.body?.profileId || "");
    if (!id && !profileRequired) return { profile: {}, guide: null };
    const profile = (await profiles(req)).find((item) => item.id === id);
    if (!profile) {
      res.status(404).json({ ok: false, error: "Choose a model this account can use." });
      return null;
    }
    return { profile, guide: guide(profile) };
  };
  const stackFrom = async (req, names) => {
    if (!Array.isArray(names) || !names.length || !allowed(req, "loras"))
      return { stack: [], infos: {} };
    const known = new Map((await loras(req)).map((item) => [item.name, item.info || {}]));
    const stack = names
      .map((item) => String(typeof item === "string" ? item : item?.name || ""))
      .filter((name) => known.has(name))
      .slice(0, 8)
      .map((name) => ({ name, triggers: known.get(name).triggers || [] }));
    return { stack, infos: Object.fromEntries(stack.map(({ name }) => [name, known.get(name)])) };
  };

  app.get("/api/assistant", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!engine || !allowed(req, "promptAssistant"))
      return res.json({ ok: true, available: false, presets: [] });
    try {
      const settings = engine.settings();
      const spicy = Boolean(settings.spicyModel) && allowed(req, "nsfwModels");
      // Profiles whose guide says a negative does nothing: the composer hides its negative writer there.
      const noNegative = (await profiles(req))
        .filter((profile) => {
          try {
            return guide(profile)?.negative?.effect === "none";
          } catch {
            return false;
          }
        })
        .map((profile) => profile.id);
      res.json({
        ok: true,
        available: true,
        model: settings.model,
        vision: await engine.supportsVision(),
        defaultPreset,
        presets: assistantPresets
          .filter((preset) => !preset.spicy || spicy)
          .map(({ id, label, description }) => ({ id, label, description })),
        spicy,
        loras: allowed(req, "loras"),
        noNegative,
      });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/assistant/rewrite", async (req, res) => {
    const signal = disconnectSignal(res);
    const context = await ready(req, res);
    if (!context || signal.aborted) return;
    const preset = String(req.body?.preset || defaultPreset);
    if (preset === "spicy" && !allowed(req, "nsfwModels"))
      return res
        .status(403)
        .json({ ok: false, error: "Spicy needs NSFW Models for this account." });
    const streaming =
      req.body?.stream === true || /text\/event-stream/i.test(String(req.headers.accept || ""));
    try {
      const references = await downscaleReferences(req.body?.references);
      const { stack } = await stackFrom(req, req.body?.loras);
      // Learning from stars: the account's starred prompts on this family, computed per request.
      const examples = (await starred(req, context.profile)).examples || [];
      const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      if (streaming) {
        // Before the first byte, so a refusal (Spicy without a model) is still a plain JSON error.
        if (preset === "spicy") spicyModelOf(engine.settings());
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Accel-Buffering": "no",
          Connection: "keep-alive",
        });
        res.flushHeaders?.();
      }
      const result = await engine.rewrite({
        profile: context.profile,
        guide: context.guide,
        prompt: req.body?.prompt,
        preset,
        references,
        stack,
        examples,
        negative: context.profile.capabilities?.negativePrompt !== false,
        signal,
        onDelta: streaming ? (text) => send("delta", { text }) : undefined,
      });
      if (streaming) {
        send("done", result);
        res.end();
      } else res.json({ ok: true, ...result });
    } catch (error) {
      if (signal.aborted) return res.end();
      if (res.headersSent) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
        return;
      }
      fail(res, error);
    }
  });

  app.post("/api/assistant/negative", async (req, res) => {
    const signal = disconnectSignal(res);
    const context = await ready(req, res);
    if (!context || signal.aborted) return;
    try {
      const { stack, infos } = await stackFrom(req, req.body?.loras);
      const cfg = Number(req.body?.cfg);
      res.json({
        ok: true,
        ...(await engine.negative({
          signal,
          profile: context.profile,
          guide: context.guide,
          prompt: req.body?.prompt,
          cfg: Number.isFinite(cfg) ? cfg : undefined,
          stack,
          infos,
        })),
      });
    } catch (error) {
      if (signal.aborted) return res.end();
      fail(res, error);
    }
  });

  app.post("/api/assistant/loras", async (req, res) => {
    const signal = disconnectSignal(res);
    const context = await ready(req, res);
    if (!context || signal.aborted) return;
    if (!allowed(req, "loras"))
      return res.status(403).json({ ok: false, error: "LoRAs are off for this account." });
    try {
      const favourite = await starred(req, context.profile);
      res.json({
        ok: true,
        ...(await engine.matchLoras({
          signal,
          profile: context.profile,
          prompt: req.body?.prompt,
          loras: await loras(req),
          starred: favourite.loras || [],
        })),
      });
    } catch (error) {
      if (signal.aborted) return res.end();
      fail(res, error);
    }
  });

  return engine;
}
