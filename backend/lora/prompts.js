// What a stacked LoRA adds to a prompt (its trigger words, leading), and the negative a profile's guide recommends.
import { cleanTriggers } from "./catalogue.js";

const has = (prompt, text) => String(prompt).toLowerCase().includes(String(text).toLowerCase());

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
 * The prompt with the trigger words switched on for each enabled LoRA (all of them unless
 * `triggers` is `false` or lists the chosen ones) at the start, in stack order, once each, skipping
 * any the prompt already says. Studio applies it once for every generation path, when it prepares
 * the run (generation-routes.js).
 */
export function withLoraTriggers(prompt, stack = [], infos = {}) {
  const text = String(prompt || "").trim();
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  const lead = [];
  for (const item of stack) {
    if (item?.enabled === false || item?.triggers === false) continue;
    const chosen = Array.isArray(item?.triggers) ? item.triggers.map(String) : null;
    for (const trigger of cleanTriggers(infos[item.name]?.triggers))
      if (
        (!chosen || chosen.some((word) => same(word, trigger))) &&
        !has(text, trigger) &&
        !lead.some((word) => same(word, trigger))
      )
        lead.push(trigger);
  }
  return lead.length ? `${lead.join(", ")}, ${text}` : text;
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
  for (const { name } of stack) {
    const own = typeof infos[name]?.negative === "string" ? infos[name].negative.trim() : "";
    if (own) parts.push(own);
  }
  return [...new Set(parts.filter(Boolean))].join(", ");
}

/** Whether the profile's guide says it takes no negative at all. */
export const negativeUnused = (prompting) => prompting?.negative?.effect === "none";
