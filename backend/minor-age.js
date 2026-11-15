// Studio makes no image or video of anyone under 18. A prompt is refused when it states an age under
// 18 or names a minor outright, or when it pairs a minor-coded word (teen, schoolgirl, school
// uniform, a student at school, child, petite and young) with sexual, nude, revealing or suggestive
// wording, whatever adult age it also states. Every path that writes or queues a prompt uses this
// one check (admission, the queue, the assistant, characters, imports) before it reaches a model.
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
// Not the end of a larger number ("twenty-one-year-old", "21-year-old").
const ageStart = "(?<![\\w-])(?<!(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\\s-]?)";
const teenAge = `(?:1[0-7]|${under18.slice(9).join("|")})`;
const patterns = [
  // "16-year-old", "16 year old", "sixteen years old", "16-17-year-old", "16yo", "16 y/o"
  new RegExp(`${ageStart}${age}(?:\\s*[-–—]\\s*\\d{1,2})?[\\s-]*(?:years?|yrs?)[\\s-]*old\\b`, "i"),
  new RegExp(`${ageStart}${age}(?:\\s*[-–—]\\s*\\d{1,2})?\\s*(?:yo|y/o|y\\.o\\.?)(?![\\w/])`, "i"),
  new RegExp(`${ageStart}${age}[\\s-]*years?[\\s-]*of[\\s-]*age\\b`, "i"),
  // "aged 16", "age: 16", "ages 16–22"
  new RegExp(`\\bage[sd]?\\s*:?\\s*${age}\\b(?!\\s*(?:mm|cm|%))`, "i"),
  /\b(?:underage|under-age|pre-?teens?|loli|lolicon|shota|shotacon|jailbait)\b/i,
];
const sexual = new RegExp(
  `\\b(?:${[
    "nude|nudes|nudity|naked|topless|bottomless|undress\\w*|strip(?:ping|pers?|tease)",
    "nsfw|sex|sexy|sexual\\w*|explicit|erotic\\w*|porn\\w*|hentai|lewd|horny|aroused|arousal",
    "seduc\\w*|sensual\\w*|sultry|alluring|provocative\\w*|suggestive\\w*|flirt\\w*",
    "lingerie|underwear|panty|panties|knickers|bras?|thongs?|g[\\s-]?strings?|bikinis?|micro[\\s-]?bikinis?",
    "revealing|skimpy|scantily|see[\\s-]?through|miniskirts?|mini[\\s-]skirts?|short skirts?|upskirt|downblouse|cleavage|cameltoe",
    "nipples?|areola\\w*|breasts?|boobs?|titties|genitals?|pussy|vagina\\w*|labia|penis|ass|buttocks",
    "orgasm\\w*|masturbat\\w*|cum|cumshot|cumming|fellatio|blow ?jobs?|hand ?jobs?|intercourse|penetration",
    "fetish\\w*|kinky|bdsm|bondage|boudoir|pin[\\s-]?up|onlyfans|playboy|grop\\w*|fondl\\w*|molest\\w*|rape",
    "spread(?:ing)? (?:her|his|their) legs|bedroom eyes|come[\\s-]hither|making out",
  ].join("|")})\\b`,
  "i",
);
const school =
  /\b(?:school\w*|classroom|homework|lockers?|detention|recess|playground|teacher'?s? pet)\b/i;
const young = new RegExp(
  `\\b(?:${[
    "teens?|teenagers?|teenaged?|teeny|tweens?|adolescen\\w*|pubescent|prepubescent|puberty",
    "school[\\s-]?(?:girls?|boys?|kids?|children|child|uniforms?)|(?:high|middle|elementary|primary|grade|junior high|secondary)[\\s-]?school(?:ers?)?|seifuku",
    "child|children|childish|child[\\s-]?like|kids?|kiddos?|toddlers?|infants?|little (?:girls?|boys?)|young (?:girls?|boys?)",
    "(?:petite|tiny|little)[\\s,-]+(?:and\\s+)?(?:young|youthful)|(?:young|youthful)[\\s-]looking|looks? (?:very |so |really )?young|very young|too young",
    "barely legal|just (?:turned )?(?:18|eighteen)|baby[\\s-]?faced?|lolita|nymphets?|under[\\s-]?(?:18|eighteen)|sweet sixteen",
    `(?:girls?|boys?|wom[ae]n|m[ae]n|she|he|her|him|daughter|son|sister|brother)(?:\\s*(?:,|\\(|is|'s|was|aged))+\\s*${teenAge}(?![\\w%/:]|\\s*(?:x|×|mm|cm|px|frames?|images?|photos?|shots?|steps?|panels?|seconds?)\\b)`,
    `${teenAge}[fm]`,
  ].join("|")})\\b`,
  "i",
);
// "Student" codes a minor only at school; an office or college student is an adult.
const student = /\bstudents?\b/i;

/** The minor-coded words in `text` and the sexual words they are paired with, if any. */
function minorMatch(text) {
  const value = String(text || "");
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match) return { words: match[0].trim(), sexual: "" };
  }
  const sexualWord = sexual.exec(value)?.[0];
  if (!sexualWord) return null;
  const words = young.exec(value)?.[0] || (school.test(value) && student.exec(value)?.[0]);
  return words ? { words: words.trim(), sexual: sexualWord } : null;
}

/** The words in `text` that code someone as under 18, or '' when there are none. */
export function minorAge(text) {
  return minorMatch(text)?.words || "";
}

/** The refusal for a prompt that codes someone as under 18, or '' when it codes none. */
export function minorAgeRefusal(text) {
  const found = minorMatch(text);
  if (!found) return "";
  return found.sexual
    ? `Studio makes no sexual or suggestive images or videos of anyone who reads as under 18, and this prompt pairs "${found.words}" with "${found.sexual}", whatever age it states. Describe only adults, without teen, school or child framing.`
    : `Studio makes no images or videos of anyone under 18, and this prompt says "${found.words}". Describe only adults, 18 or older.`;
}
