/**
 * The prompt assistant's routes. Every route is account-scoped: it needs the Prompt Assistant
 * access-profile feature, works only with profiles the account may use, and Spicy needs Uncensored Models.
 * LoRA suggestions need the LoRAs feature.
 *
 *   GET  /api/assistant                 what this account may use: presets, models, vision, and the
 *                                       profiles whose guide takes no negative (noNegative)
 *   POST /api/assistant/rewrite         { profileId, prompt, preset, instruction?, references?, loras? }
 *                                       (instruction for Custom) → streamed
 *                                       (text/event-stream: delta, done, error) or JSON
 *   POST /api/assistant/animate         { profileId, theme, instruction?, source, extend?, assetId?,
 *                                       duration?, frames?, fps? } → { prompt, model, thinking }:
 *                                       Animate's motion prompt for Review Prompt First
 *   POST /api/assistant/negative        { profileId, prompt, cfg?, loras? } → { negative | null, unused }
 *   POST /api/assistant/loras           { profileId, prompt } → { loras: [{ name, title, strength, triggers, reason }] }
 */
import {
  AssistantError,
  assistantModelKey,
  assistantSettings,
  createAssistant,
} from "./assistant.js";
import { assistantPresets, defaultPreset } from "./assistant-presets.js";
import { mayUseFeature } from "./account-policy.js";
import { directRoute } from "./domain/direct-route.ts";
import { animateClip, animateIssue, animateRequest, writeAnimatePrompt } from "./prompt-animate.js";
import { loadSharp } from "./sharp-loader.js";

const maxReferences = 4;
const maxImageBytes = 12 * 1024 * 1024;
const referenceEdge = 1024;
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;

export const assistantSettingKeys = Object.freeze([assistantModelKey]);

export const promptAssistantOff = "The prompt assistant is off for this account.";

/** Whether an account (or single-user Studio, with no account) has a feature. */
const allowed = (account, feature) => !account || mayUseFeature(account, feature);

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

/**
 * Settings › Integrations: the assistant's gateway, chosen model and vision, and the models
 * to choose from: the gateway's and those of Studio's text workloads (`workloadModels`).
 */
export async function assistantIntegration({
  environment = process.env,
  engine,
  source,
  workloadModels = [],
}) {
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
      note:
        problem || "Set STUDIO_ASSISTANT_URL, _KEY and _CLOUD_MODEL to use the prompt assistant.",
      models: [],
      model: row(assistantModelKey, ""),
    };
  const [models, vision, model] = await Promise.all([
    engine.listModels(),
    engine.supportsVision(),
    engine.model("rewrite"),
  ]);
  return {
    available: true,
    models: [...new Set([...models, ...workloadModels])],
    model: { ...row(assistantModelKey, model), vision },
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
 * profile)`: { examples, loras } from starred results on the same family. `frame(req, assetId)`: a
 * reference image the account may use, as the text model reads it; `caption(req, assetId)` what it
 * shows in words.
 */
export function registerAssistantRoutes(
  app,
  {
    environment = process.env,
    fetchImpl = fetch,
    localText,
    engine = createAssistant(environment, { fetchImpl, localText }),
    profiles = async () => [],
    guide = () => null,
    loras = async () => [],
    starred = async () => ({ examples: [], loras: [] }),
    frame = async () => null,
    caption = () => "",
  } = {},
) {
  const failure = (error) => {
    const status = error instanceof AssistantError ? error.status : Number(error?.status) || 400;
    return {
      status: status >= 400 && status < 600 ? status : 502,
      payload: {
        ok: false,
        error:
          error instanceof AssistantError && error.status >= 500
            ? `The prompt assistant is unavailable (${error.reason}).`
            : error.message,
      },
    };
  };
  const refuse = (status, error) => ({ refusal: { status, payload: { ok: false, error } } });
  /** The engine and the account's profile, or `refusal`: the answer explaining why not. */
  const ready = async (account, body) => {
    if (!allowed(account, "promptAssistant")) return refuse(403, promptAssistantOff);
    if (!engine) return refuse(503, "The prompt assistant is not configured.");
    const id = String(body?.profileId || "");
    const profile = (await profiles({ studioAccount: account })).find((item) => item.id === id);
    if (!profile) return refuse(404, "Choose a model this account can use.");
    return { profile, guide: guide(profile) };
  };
  const stackFrom = async (account, names) => {
    if (!Array.isArray(names) || !names.length || !allowed(account, "loras"))
      return { stack: [], infos: {} };
    const known = new Map(
      (await loras({ studioAccount: account })).map((item) => [item.name, item.info || {}]),
    );
    const stack = names
      .map((item) => String(typeof item === "string" ? item : item?.name || ""))
      .filter((name) => known.has(name))
      .slice(0, 8)
      .map((name) => ({ name, triggers: known.get(name).triggers || [] }));
    return { stack, infos: Object.fromEntries(stack.map(({ name }) => [name, known.get(name)])) };
  };
  /**
   * An assistant route that writes with the account's profile: `write(account, body, context,
   * stop)` runs once `ready` passes; `stop` ends the work when the caller goes away.
   */
  const writer = (path, write) =>
    directRoute(app, "POST", path, async (account, { body, stop }) => {
      const context = await ready(account, body);
      // A caller that went away during the checks starts nothing; no one reads this answer.
      if (stop?.aborted) return { status: 499, payload: {} };
      if (context.refusal) return context.refusal;
      try {
        return await write(account, body, context, stop);
      } catch (error) {
        return failure(error);
      }
    });

  // Assistant answers are never cached, and a caller that goes away ends the work it asked for.
  app.use("/api/assistant", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    req.stop = disconnectSignal(res);
    next();
  });

  app.get("/api/assistant", async (req, res) => {
    const account = req.studioAccount;
    // Without the feature the app hides every assistant control, as without a gateway.
    if (!engine || !allowed(account, "promptAssistant"))
      return res.json({ ok: true, available: false, presets: [] });
    try {
      const spicy = allowed(account, "uncensoredModels");
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
        model: await engine.model("rewrite"),
        vision: await engine.supportsVision(),
        defaultPreset,
        presets: assistantPresets
          .filter((preset) => !preset.spicy || spicy)
          .map(({ id, label, description }) => ({ id, label, description })),
        spicy,
        loras: allowed(account, "loras"),
        noNegative,
      });
    } catch (error) {
      const { status, payload } = failure(error);
      res.status(status).json(payload);
    }
  });

  /** Rewrite's engine call, after its checks; `begin()` runs just before the model writes. */
  const rewrite = async (account, body, context, { signal, begin, onDelta } = {}) => {
    const references = await downscaleReferences(body?.references);
    const { stack } = await stackFrom(account, body?.loras);
    // Learning from stars: the account's starred prompts on this family, computed per request.
    const examples = (await starred({ studioAccount: account }, context.profile)).examples || [];
    begin?.();
    return engine.rewrite({
      profile: context.profile,
      guide: context.guide,
      prompt: body?.prompt,
      preset: String(body?.preset || defaultPreset),
      instruction: body?.instruction,
      explicit: allowed(account, "uncensoredModels"),
      references,
      stack,
      examples,
      negative: context.profile.capabilities?.negativePrompt !== false,
      signal,
      onDelta,
    });
  };
  const spicyRefused = (account, body) =>
    String(body?.preset || defaultPreset) === "spicy" && !allowed(account, "uncensoredModels");
  // A streamed rewrite (text/event-stream: delta, done, error) answers here; a JSON one below.
  app.post("/api/assistant/rewrite", async (req, res, next) => {
    if (req.body?.stream !== true && !/text\/event-stream/i.test(String(req.headers.accept || "")))
      return next();
    const signal = req.stop;
    const account = req.studioAccount;
    const context = await ready(account, req.body);
    if (signal.aborted) return;
    if (context.refusal) return res.status(context.refusal.status).json(context.refusal.payload);
    if (spicyRefused(account, req.body))
      return res
        .status(403)
        .json({ ok: false, error: "Spicy needs Uncensored Models for this account." });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      const result = await rewrite(account, req.body, context, {
        signal,
        begin: () => {
          res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
            Connection: "keep-alive",
          });
          res.flushHeaders?.();
        },
        onDelta: (text) => send("delta", { text }),
      });
      send("done", result);
      res.end();
    } catch (error) {
      if (signal.aborted) return res.end();
      if (res.headersSent) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
        return;
      }
      const { status, payload } = failure(error);
      res.status(status).json(payload);
    }
  });
  writer("/api/assistant/rewrite", async (account, body, context, signal) => {
    if (spicyRefused(account, body))
      return {
        status: 403,
        payload: { ok: false, error: "Spicy needs Uncensored Models for this account." },
      };
    return {
      status: 200,
      payload: { ok: true, ...(await rewrite(account, body, context, { signal })) },
    };
  });

  // The queue's writing stage writes the same prompt (prompt-stage.js); this one returns it unqueued.
  writer("/api/assistant/animate", async (account, body, context, signal) => {
    const writing = animateRequest(body);
    const issue = animateIssue(writing, { allowed: (feature) => allowed(account, feature) });
    if (issue) return { status: issue.status, payload: { ok: false, error: issue.error } };
    const assetId = String(body?.assetId || "");
    return {
      status: 200,
      payload: {
        ok: true,
        ...(await writeAnimatePrompt({
          ...context,
          engine,
          writing,
          clip: animateClip(body, context.profile),
          explicit: allowed(account, "uncensoredModels"),
          frame: () => frame({ studioAccount: account }, assetId),
          caption: () => caption({ studioAccount: account }, assetId),
          signal,
        })),
      },
    };
  });

  writer("/api/assistant/negative", async (account, body, context, signal) => {
    const { stack, infos } = await stackFrom(account, body?.loras);
    const cfg = Number(body?.cfg);
    return {
      status: 200,
      payload: {
        ok: true,
        ...(await engine.negative({
          signal,
          profile: context.profile,
          guide: context.guide,
          prompt: body?.prompt,
          cfg: Number.isFinite(cfg) ? cfg : undefined,
          stack,
          infos,
        })),
      },
    };
  });

  writer("/api/assistant/loras", async (account, body, context, signal) => {
    if (!allowed(account, "loras"))
      return { status: 403, payload: { ok: false, error: "LoRAs are off for this account." } };
    const favourite = await starred({ studioAccount: account }, context.profile);
    return {
      status: 200,
      payload: {
        ok: true,
        ...(await engine.matchLoras({
          signal,
          profile: context.profile,
          prompt: body?.prompt,
          loras: await loras({ studioAccount: account }),
          starred: favourite.loras || [],
        })),
      },
    };
  });

  return engine;
}
