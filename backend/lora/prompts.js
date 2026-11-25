import { activeLora, loraTriggerWords } from "../../shared/profiles.ts";
// What a stacked LoRA adds to a prompt (its trigger words, leading), and the negative a profile's guide recommends.
import { cleanTriggers } from "./catalogue.js";

function hasTrigger(prompt, trigger) {
  const word = "[\\p{L}\\p{M}\\p{N}_]";
  const start = new RegExp(`^${word}`, "u").test(trigger) ? `(?<!${word})` : "";
  const end = new RegExp(`${word}$`, "u").test(trigger) ? `(?!${word})` : "";
  const phrase = trigger.split(/\s+/).map(RegExp.escape).join("\\s+");
  return new RegExp(`${start}${phrase}${end}`, "iu").test(prompt);
}

/**
 * A stacked LoRA's Trigger Words choice as a run, record or MCP stack keeps it: `false` for none,
 * the words switched on, or nothing for all of them (the default).
 */
export const keptTriggers = (triggers) =>
  triggers === false
    ? { triggers: false }
    : Array.isArray(triggers)
      ? { triggers: cleanTriggers(triggers) }
      : {};

/**
 * The prompt with the trigger words switched on for each enabled LoRA (all of them, or a slider's
 * one end, unless `triggers` is `false` or lists the chosen ones) at the start, in stack order, once each, skipping
 * any the prompt already says. Studio applies it once for every generation path, when it prepares
 * the run (generation-routes.js).
 */
export function withLoraTriggers(prompt, stack = [], infos = {}) {
  const text = String(prompt || "").trim();
  const lead = new Map();
  for (const item of stack) {
    if (!activeLora(item)) continue;
    const info = infos[item.name];
    for (const trigger of loraTriggerWords(item, {
      ...info,
      triggers: cleanTriggers(info?.triggers),
    })) {
      const key = trigger.toLowerCase().replace(/\s+/g, " ");
      if (!lead.has(key) && !hasTrigger(text, trigger)) lead.set(key, trigger);
    }
  }
  return [...lead.values(), text].filter(Boolean).join(", ");
}

/**
 * The negative to fill when the caller gave none: the guide's default where its effect is
 * "recommended" and the profile takes a negative above CFG 1, plus any stacked LoRA's own negative.
 * "optional" and "none" fill nothing. Returns '' when nothing is filled.
 */
export function recommendedNegative(
  prompting,
  { cfg, takesNegative = true, stack = [], infos = {} } = {},
) {
  const negative = prompting?.negative;
  if (!takesNegative || negative?.effect !== "recommended" || !(Number(cfg) > 1)) return "";
  const parts = [String(negative.default || "").trim()];
  for (const item of stack) {
    if (!activeLora(item)) continue;
    const { name } = item;
    const own = typeof infos[name]?.negative === "string" ? infos[name].negative.trim() : "";
    if (own) parts.push(own);
  }
  return [...new Set(parts.filter(Boolean))].join(", ");
}

/** Whether the profile's guide says it takes no negative at all. */
export const negativeUnused = (prompting) => prompting?.negative?.effect === "none";
