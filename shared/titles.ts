/** Short titles the text model writes for chats and gallery items, and the stand-in until it has. */

const capitalised = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : "");

/** A prompt's first clause, without weights or tags, as a title; empty for an empty prompt. */
export function promptWords(prompt: unknown) {
  const text = String(prompt || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[()[\]{}]/g, "")
    .replace(/:\s*-?\d+(\.\d+)?/g, "")
    .trim();
  const clause = (text.split(/[,.;|!?\n]/)[0].trim() || text).replace(/\s+/g, " ");
  return capitalised(
    clause.length > 64 ? `${clause.slice(0, 61).replace(/\s+\S*$/, "")}…` : clause,
  );
}

/** The model's reply as a title: its first line, at most six words, without quotes or a label. */
export function replyTitle(reply: unknown) {
  return capitalised(
    String(reply || "")
      .trim()
      .split("\n")[0]
      .replace(/^title:\s*/i, "")
      .replace(/["'“”‘’*_`#]/g, "")
      .replace(/[\s.,;:!?-]+$/, "")
      .split(/\s+/)
      .slice(0, 6)
      .join(" ")
      .slice(0, 64),
  );
}
