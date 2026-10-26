// SPDX-License-Identifier: AGPL-3.0-only
// What a stacked LoRA adds to a written prompt, and the negative a profile's guide recommends.
// The base prompt stays natural language: triggers lead as words, tag-trained LoRAs get one short line of tags.
import { cleanTriggers } from "./lora-catalogue.js";

const maxTagLine = 6;
const words = (value) =>
  String(value || "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) || [];
const has = (prompt, text) => String(prompt).toLowerCase().includes(String(text).toLowerCase());

/** "tags" | "mixed" | "natural"; anything else (or nothing) reads as natural. */
export function loraPromptStyle(info) {
  return ["tags", "mixed"].includes(info?.promptStyle) ? info.promptStyle : "natural";
}

/**
 * A tag-trained LoRA's tags that fit the request: those sharing a word with it, else its first few
 * (they describe what it was trained on), never ones the prompt already says.
 */
export function relevantTags(info, request, prompt = "") {
  const tags = (Array.isArray(info?.tags) ? info.tags : [])
    .filter((tag) => typeof tag === "string" && tag.trim())
    .map((tag) => tag.trim())
    .slice(0, 10);
  const asked = new Set(words(request));
  const matching = tags.filter((tag) => words(tag).some((word) => asked.has(word)));
  return (matching.length ? matching : tags.slice(0, 3))
    .filter((tag) => !has(prompt, tag))
    .slice(0, maxTagLine);
}

/**
 * The prompt with the trigger words of each enabled LoRA whose Trigger Words toggle is on
 * (`triggers !== false`) at the start, in stack order, once each, skipping any the prompt already
 * says. Studio applies it once for every generation path, when it prepares the run (generation-routes.js).
 */
export function withLoraTriggers(prompt, stack = [], infos = {}) {
  const text = String(prompt || "").trim();
  const lead = [];
  for (const item of stack) {
    if (item?.enabled === false || item?.triggers === false) continue;
    for (const trigger of cleanTriggers(infos[item.name]?.triggers))
      if (!has(text, trigger) && !lead.some((word) => word.toLowerCase() === trigger.toLowerCase()))
        lead.push(trigger);
  }
  return lead.length ? `${lead.join(", ")}, ${text}` : text;
}

/** A prompt Studio wrote, with one comma-separated line of the tags "tags" or "mixed" LoRAs find relevant to the request. */
export function withLoraTags(prompt, stack = [], infos = {}, request = "") {
  const text = String(prompt || "").trim();
  const tagLine = [];
  for (const { name } of stack)
    if (loraPromptStyle(infos[name]) !== "natural")
      for (const tag of relevantTags(infos[name], request, text))
        if (!tagLine.includes(tag)) tagLine.push(tag);
  return tagLine.length ? `${text}\n${tagLine.slice(0, maxTagLine).join(", ")}` : text;
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
