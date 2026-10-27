// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The viewer's Animate menu: the prompt assistant writes an image-to-video motion prompt from the
 * source image's prompt and a theme, through the same engine (assistant.js) and access rules as
 * assistant-routes.js. Spicy runs on the Spicy model and needs NSFW Models.
 *
 *   POST /api/assistant/animate   { profileId, prompt, theme, instruction? } → { prompt, model }
 */
import { mayUseFeature } from "./account-policy.js";
import { AssistantError, cleanPrompt, maxPromptCharacters, writerGuide } from "./assistant.js";

export const animateThemes = Object.freeze({
  cinematic:
    "Cinematic Camera: a deliberate, motivated camera move (push-in, orbit, crane or tracking shot) with subtle subject motion and atmosphere.",
  living:
    "Living Photo: the camera stays still; bring the frame gently to life with small natural motion such as breathing, blinking, hair, fabric, water, leaves, light and particles.",
  action:
    "Action: the subject performs one clear, energetic action that suits the scene, with dynamic but readable motion and a camera that follows it.",
  spicy:
    "Spicy: sensual, explicit motion where the scene allows it, with frank, specific wording about bodies and movement. Every person is an adult.",
  custom: "Follow the person's instruction for what should happen.",
});

const allowed = (req, feature) => !req.studioAccount || mayUseFeature(req.studioAccount, feature);

/**
 * `profiles(req)`: the generation profiles this account may use. `guide(profile)`: its prompting
 * guide or null.
 */
export function registerAnimatePromptRoute(app, { engine, profiles, guide }) {
  app.post("/api/assistant/animate", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const theme = String(req.body?.theme || "");
    const instruction = String(req.body?.instruction || "")
      .trim()
      .slice(0, 1000);
    const source = String(req.body?.prompt || "")
      .trim()
      .slice(0, maxPromptCharacters);
    if (!engine)
      return res.status(503).json({ ok: false, error: "The prompt assistant is not configured." });
    if (!allowed(req, "promptAssistant"))
      return res
        .status(403)
        .json({ ok: false, error: "The prompt assistant is off for this account." });
    if (!Object.hasOwn(animateThemes, theme))
      return res.status(400).json({ ok: false, error: "Choose a known animation theme." });
    if (theme === "custom" && !instruction)
      return res.status(400).json({ ok: false, error: "Describe what should happen." });
    if (theme === "spicy" && !allowed(req, "nsfwModels"))
      return res
        .status(403)
        .json({ ok: false, error: "Spicy needs NSFW Models for this account." });
    const profile = (await profiles(req)).find(
      (item) => item.id === String(req.body?.profileId || "") && item.kind === "video",
    );
    if (!profile)
      return res
        .status(404)
        .json({ ok: false, error: "Choose a video model this account can use." });
    try {
      const settings = engine.settings();
      const model = theme === "spicy" ? settings.spicyModel : settings.model;
      if (!model)
        throw new AssistantError(
          "Spicy needs a Spicy model. An administrator chooses one in Settings › Models › Integrations.",
          { status: 409 },
        );
      const reply = await engine.chat({
        model,
        messages: [
          {
            role: "system",
            content: [
              `You write motion prompts for the image-to-video model ${profile.label || profile.id}. Follow its prompting guide below.`,
              "The image is the first frame. Describe the motion, action and camera from that frame in one short paragraph (under 80 words), without re-describing what is already visible.",
              "Reply with the prompt only, as plain text: no preamble, labels, quotes, Markdown or notes.",
              `Theme: ${animateThemes[theme]}`,
              `Prompting guide: ${writerGuide(guide(profile)) || "(none; write a clear, specific natural-language prompt)"}`,
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              `The first frame was generated from: ${source || "(no prompt recorded)"}`,
              instruction ? `Instruction: ${instruction}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
        temperature: 0.8,
        // Reasoning models spend part of this on thinking before the prompt.
        maxTokens: 1500,
      });
      const prompt = cleanPrompt(reply.text);
      if (!prompt) throw new AssistantError("unusable reply");
      res.json({ ok: true, prompt, model });
    } catch (error) {
      const status = error instanceof AssistantError ? error.status : 502;
      res.status(status >= 400 && status < 600 ? status : 502).json({
        ok: false,
        error:
          error instanceof AssistantError && status < 500
            ? error.message
            : `The prompt assistant is unavailable (${error.reason || "unreachable"}).`,
      });
    }
  });
}
