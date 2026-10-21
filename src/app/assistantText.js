// The prompt assistant's text rules in the composer (PromptAssistant.tsx): trigger words that a
// suggested LoRA brings into the prompt, and whether a prompt is still the one the assistant wrote.

const lower = (value) => String(value || '').toLowerCase();
const clean = (triggers) => [...new Set((Array.isArray(triggers) ? triggers : []).map((word) => String(word || '').trim()).filter(Boolean))];

/** The triggers the prompt doesn't say yet (a case-insensitive match anywhere counts as said). */
export function missingTriggers(prompt, triggers) {
  const text = lower(prompt);
  return clean(triggers).filter((word) => !text.includes(lower(word)));
}

/**
 * The prompt with a LoRA's missing triggers at its start ("glowfx, a cabin"), as LoRAs are usually
 * trained; triggers already present stay where they are. `inserted` lists the words added.
 */
export function insertTriggers(prompt, triggers) {
  const inserted = missingTriggers(prompt, triggers);
  const text = String(prompt || '');
  if (!inserted.length) return { prompt: text, inserted };
  const rest = text.replace(/^[\s,]+/, '');
  return { prompt: rest ? `${inserted.join(', ')}, ${rest}` : inserted.join(', '), inserted };
}

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The prompt without these trigger words and the commas around them; other text is untouched. */
export function removeTriggers(prompt, triggers) {
  let text = String(prompt || '');
  for (const word of clean(triggers)) {
    const pattern = new RegExp(`(^|[\\s,])${escape(word)}(?=$|[\\s,.;:!?])`, 'i');
    text = text.replace(pattern, '$1');
  }
  return text.replace(/^[\s,]+/, '').replace(/,(\s*,)+/g, ',').replace(/[ \t]{2,}/g, ' ').replace(/[\s,]+$/, (end) => end.includes('\n') ? '\n' : '').trimEnd();
}

/** Whether the prompt still says any of the words. */
export function saysAny(prompt, triggers) {
  const text = lower(prompt);
  return clean(triggers).some((word) => text.includes(lower(word)));
}

const words = (value) => lower(value).match(/[\p{L}\p{N}]+/gu) || [];

/**
 * Whether `prompt` is still essentially the assistant's `written` text (kept after small edits):
 * at least half of the written words are still there. A cleared or replaced prompt is not.
 */
export function stillWritten(prompt, written) {
  const mine = words(written);
  if (!mine.length) return false;
  const now = new Set(words(prompt));
  return mine.filter((word) => now.has(word)).length / mine.length >= 0.5;
}
