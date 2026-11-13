// Studio makes no image or video of anyone under 18: a prompt that states such an age, or a sexual
// or nude one that calls someone a teen or a schoolchild, is refused on every path (composer, MCP,
// Dream, written prompts), before it reaches a model.
const under18 = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
];
const age = `(?:1[0-7]|[1-9]|${under18.join("|")})`;
const patterns = [
  // "16-year-old", "16 year old", "sixteen years old", "16-17-year-old", "16yo", "16 y/o"
  new RegExp(`\\b${age}(?:\\s*[-–—]\\s*\\d{1,2})?[\\s-]*(?:years?|yrs?)[\\s-]*old\\b`, "i"),
  new RegExp(`\\b${age}(?:\\s*[-–—]\\s*\\d{1,2})?\\s*(?:yo|y/o|y\\.o\\.)(?![\\w/])`, "i"),
  // "aged 16", "age: 16", "ages 16–22"
  new RegExp(`\\bage[sd]?\\s*:?\\s*${age}\\b(?!\\s*(?:mm|cm|%))`, "i"),
  /\b(?:underage|under-age|pre-?teens?|loli|shota)\b/i,
];
const sexual =
  /\b(?:nude|nudity|naked|topless|bottomless|nsfw|sex|sexy|sexual|explicit|erotic|porn\w*|lingerie|nipples?|breasts?|genitals?|pussy|vagina|penis|cock|orgasm\w*|masturbat\w*|undress\w*|strip(?:ping|tease))\b/i;
const young =
  /\b(?:teens?|teenagers?|teenage|teeny|school ?(?:girls?|boys?|kids?|children)|high ?school)\b/i;

/** The words in `text` that state an age under 18, or '' when there are none. */
export function minorAge(text) {
  const value = String(text || "");
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match) return match[0].trim();
  }
  if (!sexual.test(value)) return "";
  return young.exec(value)?.[0] || "";
}

/** The refusal for a prompt that states an age under 18, or '' when it states none. */
export function minorAgeRefusal(text) {
  const found = minorAge(text);
  return found
    ? `Studio makes no images or videos of anyone under 18, and this prompt says "${found}". Describe only adults, 18 or older.`
    : "";
}
