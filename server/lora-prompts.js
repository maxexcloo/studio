// SPDX-License-Identifier: AGPL-3.0-only
// What a stacked LoRA adds to a written prompt, and the negative a profile's guide recommends.
// The base prompt stays natural language: triggers go in as words, tag-trained LoRAs get one short line of tags.
import { cleanTriggers } from './lora-catalogue.js';

const maxTagLine = 6;
const words = (value) => String(value || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const has = (prompt, text) => String(prompt).toLowerCase().includes(String(text).toLowerCase());

/** "tags" | "mixed" | "natural"; anything else (or nothing) reads as natural. */
export function loraPromptStyle(info) {
  return ['tags', 'mixed'].includes(info?.promptStyle) ? info.promptStyle : 'natural';
}

/** Whether the LoRA's note or guidance asks for its trigger at the very start. */
const triggerFirst = (info) => /put the trigger (?:word )?first/i.test(`${info?.note || ''} ${info?.guidance || ''}`);

/**
 * A tag-trained LoRA's tags that fit the request: those sharing a word with it, else its first few
 * (they describe what it was trained on), never ones the prompt already says.
 */
export function relevantTags(info, request, prompt = '') {
  const tags = (Array.isArray(info?.tags) ? info.tags : []).filter((tag) => typeof tag === 'string' && tag.trim()).map((tag) => tag.trim()).slice(0, 10);
  const asked = new Set(words(request));
  const matching = tags.filter((tag) => words(tag).some((word) => asked.has(word)));
  return (matching.length ? matching : tags.slice(0, 3)).filter((tag) => !has(prompt, tag)).slice(0, maxTagLine);
}

/**
 * The prompt with each stacked LoRA's triggers (first when its note says so, otherwise at the end) and,
 * for "tags" or "mixed" LoRAs, one comma-separated line of the tags relevant to the request. `tags: false`
 * (a caller's own prompt) adds only the missing triggers.
 */
export function withLoraPrompting(prompt, stack = [], infos = {}, request = '', { tags = true } = {}) {
  let text = String(prompt || '').trim();
  const lead = [];
  const tail = [];
  const tagLine = [];
  for (const { name } of stack) {
    const info = infos[name] || {};
    const triggers = cleanTriggers(info.triggers).filter((trigger) => !has(text, trigger));
    (triggerFirst(info) ? lead : tail).push(...triggers);
    if (tags && loraPromptStyle(info) !== 'natural') for (const tag of relevantTags(info, request, text)) if (!tagLine.includes(tag)) tagLine.push(tag);
  }
  if (lead.length) text = `${[...new Set(lead)].join(', ')}, ${text}`;
  if (tail.length) text = `${text.replace(/[.,;\s]+$/, '')}, ${[...new Set(tail)].join(', ')}`;
  if (tagLine.length) text = `${text}\n${tagLine.slice(0, maxTagLine).join(', ')}`;
  return text;
}

/**
 * The negative to fill when the caller gave none: the guide's default where its effect is
 * "recommended" and the profile takes a negative above CFG 1, plus any stacked LoRA's own negative.
 * "optional" and "none" fill nothing. Returns '' when nothing is filled.
 */
export function recommendedNegative(prompting, { cfg, takesNegative = true, stack = [], infos = {} } = {}) {
  const negative = prompting?.negative;
  if (!takesNegative || negative?.effect !== 'recommended' || !(Number(cfg) > 1)) return '';
  const parts = [String(negative.default || '').trim()];
  for (const { name } of stack) {
    const own = typeof infos[name]?.negative === 'string' ? infos[name].negative.trim() : '';
    if (own) parts.push(own);
  }
  return [...new Set(parts.filter(Boolean))].join(', ');
}

/** Whether the profile's guide says it takes no negative at all. */
export const negativeUnused = (prompting) => prompting?.negative?.effect === 'none';
