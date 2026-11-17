/** Short Title Case titles: the ones text models write for gallery items, sets and labels, and the stand-in until they have. */

/** How every title writer asks for one. */
export const titleRule =
  "a Title Case title of two to five words naming its subject, a complete phrase that reads as a name rather than a sentence or request";

// Lower case inside a title.
const minor =
  /^(a|an|and|as|at|but|by|for|from|in|into|nor|of|on|onto|or|per|the|to|via|vs|with)$/i;
// Where a phrase can end before the next begins: a shortened title stops before one of these.
const boundary =
  /^(a|an|and|as|at|but|by|for|from|in|into|nor|of|on|onto|or|per|the|to|via|vs|with|above|across|after|against|along|among|around|before|behind|below|beneath|beside|between|beyond|during|holding|inside|near|outside|over|through|under|underneath|while|wearing|within|without)$/i;

/** Title Case: each word capitalised, minor words lower case except first and last. */
export function titleCase(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words
    .map((word, index) =>
      index > 0 && index < words.length - 1 && minor.test(word)
        ? word.toLowerCase()
        : // A word with its own capitals (NASA, iPhone) keeps them.
          /\p{Lu}/u.test(word)
          ? word
          : word.replace(/(^|[-/])\p{L}/gu, (letter) => letter.toUpperCase()),
    )
    .join(" ");
}

/**
 * At most `max` words, shortened by whole phrases rather than cut mid-phrase: it ends before the
 * last phrase boundary that fits ("Red Barn by the River beneath Storm Clouds" is "Red Barn by the
 * River"), or with none, keeps the noun phrase's last words, where English puts its head ("Tiny
 * Sleeping Maltese Shih Tzu Puppy" is "Sleeping Maltese Shih Tzu Puppy").
 */
function shorten(words: string[], max: number) {
  if (words.length <= max) return words;
  for (let end = max; end > 0; end--)
    if (boundary.test(words[end])) {
      const kept = words.slice(0, end);
      while (kept.length > 1 && minor.test(kept.at(-1)!)) kept.pop();
      return kept;
    }
  return words.slice(-max);
}

/** A prompt's first clause, without weights, tags or request wording, as a title; empty for an empty prompt. */
export function promptWords(prompt: unknown) {
  const text = String(prompt || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[()[\]{}]/g, "")
    .replace(/:\s*-?\d+(\.\d+)?/g, "")
    .trim();
  const clause = (text.split(/[,.;|!?\n]/)[0].trim() || text).replace(/\s+/g, " ");
  return replyTitle(
    clause
      .replace(
        /^(?:please\s+)?(?:generate|create|make|draw|render)\s+(?:(?:an?|some|\d+)\s+)?(?:images?|pictures?|photos?|illustrations?|videos?)\s+(?:of\s+)?/i,
        "",
      )
      .replace(/^(?:an?|the)\s+/i, ""),
  );
}

/** Text as a Title Case title of at most `max` words, shortened by whole phrases. */
export function shortTitle(text: string, max = 5) {
  return titleCase(shorten(text.trim().split(/\s+/).filter(Boolean), max).join(" "));
}

/** A model's reply as a title: its first line, at most five words, without quotes or a label. */
export function replyTitle(reply: unknown) {
  return shortTitle(
    String(reply || "")
      .trim()
      .split("\n")[0]
      .replace(/^title:\s*/i, "")
      .replace(/["'“”‘’*_`#]/g, "")
      .replace(/[\s.,;:!?-]+$/, ""),
  );
}
