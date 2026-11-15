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
 * A LoRA's trigger words to apply by default. A slider's two words name its two ends, so only the
 * end its strength points to: the first for a positive strength, the second for a negative one.
 */
function defaultTriggers(item, info) {
  const triggers = cleanTriggers(info?.triggers);
  if (triggers.length !== 2 || !/slider/i.test(`${item.name} ${info?.title || ""}`))
    return triggers;
  return [Number(item.strength) < 0 ? triggers[1] : triggers[0]];
}

/**
 * The prompt with the trigger words switched on for each enabled LoRA (all of them, or a slider's
 * one end, unless `triggers` is `false` or lists the chosen ones) at the start, in stack order, once each, skipping
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
    const triggers = chosen
      ? cleanTriggers(infos[item.name]?.triggers).filter((trigger) =>
          chosen.some((word) => same(word, trigger)),
        )
      : defaultTriggers(item, infos[item.name]);
    for (const trigger of triggers)
      if (!has(text, trigger) && !lead.some((word) => same(word, trigger))) lead.push(trigger);
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
