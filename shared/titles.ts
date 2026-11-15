/** Short titles the text model writes for gallery items, and the stand-in until it has. */

const smallWords = /^(a|an|and|as|at|but|by|for|in|nor|of|on|or|per|the|to|via|vs)$/i;
const titleCase = (text: string) => {
  const words = text.split(/\s+/);
  return words
    .map((word, index) =>
      index > 0 && index < words.length - 1 && smallWords.test(word)
        ? word.toLowerCase()
        : word.replace(/(^|[-/])\p{L}/gu, (letter) => letter.toUpperCase()),
    )
    .join(" ");
};

/** A prompt's first clause, without weights or tags, as a title; empty for an empty prompt. */
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
        /^(?:please\s+)?(?:generate|create|make|draw|render)\s+(?:(?:an?|some|\d+)\s+)?(?:images?|pictures?|photos?|illustrations?)\s+(?:of\s+)?/i,
        "",
      )
      .replace(/^(?:an?|the)\s+/i, ""),
  );
}

/** The model’s reply as a title: its first line, at most five words, without quotes or a label. */
export function replyTitle(reply: unknown) {
  return titleCase(
    String(reply || "")
      .trim()
      .split("\n")[0]
      .replace(/^title:\s*/i, "")
      .replace(/["'“”‘’*_`#]/g, "")
      .replace(/[\s.,;:!?-]+$/, "")
      .split(/\s+/)
      .slice(0, 5)
      .join(" ")
      .slice(0, 64),
  );
}
