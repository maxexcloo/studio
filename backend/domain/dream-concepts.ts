/**
 * Dream's latest this many image results set its diversity budget: a profile or LoRA weighs less by
 * the share of them it took (to no less than `floor`), and results at least `alike` like another
 * by image are named to the writer as ground to move away from.
 */
export const diversity = { results: 20, floor: 0.2, alike: 0.9 };
export const motifWindow = 12;
export const recentPromptCharacters = 400;
const motifFrequency = 2;

/** An idea sharing more than this share of its content words with a recent one is a repeat. */
const repeatOverlap = 0.6;

export const clean = (value: unknown, limit: number) =>
  String(typeof value === "string" ? value : "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
export const normalised = (prompt: string) => prompt.toLowerCase().replace(/\s+/g, " ").trim();
export const phraseWords = (text: string) =>
  normalised(text.normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " "));

/** Independent starting points for a new concept; explicit tastes and briefs take precedence. */
const axes: Record<string, string[]> = {
  action: [
    "a chase or race",
    "a quiet exchange",
    "an interrupted everyday ritual",
    "balancing or climbing",
    "building or repairing something",
    "discovering an unexpected place",
    "exploring an unfamiliar environment",
    "performing for an audience",
    "preparing for a celebration",
    "resting after a journey",
    "sheltering from the weather",
    "transforming or unfolding",
  ],
  subject: [
    "an animal",
    "a lone figure",
    "a crowd",
    "an everyday object",
    "a machine",
    "a building",
    "a plant or flower",
    "food and drink",
    "a vehicle",
    "a mythical creature",
    "a pair of people",
    "a still life",
  ],
  setting: [
    "a city street at street level",
    "a desert",
    "deep forest",
    "underwater",
    "a cramped interior",
    "a rooftop",
    "a coastline",
    "high mountains",
    "outer space",
    "a market",
    "a ruin",
    "a snowfield",
  ],
  "medium or style": [
    "35mm film photograph",
    "oil painting",
    "watercolor",
    "ink drawing",
    "3D render",
    "papercraft",
    "woodblock print",
    "claymation",
    "pixel art",
    "studio portrait photography",
    "comic book art",
    "charcoal sketch",
  ],
  lighting: [
    "golden hour",
    "blue hour",
    "harsh midday sun",
    "neon",
    "candlelight",
    "overcast softness",
    "a single hard spotlight",
    "backlit silhouette",
    "moonlight",
    "fog-diffused light",
  ],
  era: [
    "ancient",
    "medieval",
    "the 1920s",
    "the 1960s",
    "the 1980s",
    "present day",
    "near future",
    "far future",
    "Victorian",
  ],
  mood: [
    "serene",
    "eerie",
    "playful",
    "melancholic",
    "triumphant",
    "tense",
    "dreamy",
    "cozy",
    "chaotic",
    "lonely",
  ],
  "camera or composition": [
    "extreme close-up",
    "wide establishing shot",
    "bird's-eye view",
    "low angle",
    "symmetrical framing",
    "shallow depth of field",
    "long exposure",
    "fisheye lens",
    "rule of thirds with negative space",
    "Dutch angle",
  ],
};
const stopWords = new Set(
  "a an and are as at be by for from in into is it its of on or over the their there these this to under while with without".split(
    " ",
  ),
);
const contentWords = (text: string) =>
  new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((word) => !stopWords.has(word)),
  );
/** Jaccard overlap of two word sets. */
function overlap(a: Set<string>, b: Set<string>) {
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  const union = a.size + b.size - shared;
  return union ? shared / union : 0;
}
/** A short subject for an idea: its title, else its opening words. */
export const subjectOf = (title: unknown, prompt: unknown) =>
  clean(title, 80) || clean(prompt, 400).split(" ").slice(0, 6).join(" ");

const motifAliases = [
  [
    "laundry",
    /\b(?:laundry|laundromats?|launderettes?|washing machines?|clotheslines?|wash(?:ing|es) clothes)\b/i,
  ],
  [
    "smoking",
    /\b(?:smoking|cigarettes?|cigars?|ashtrays?|tobacco pipes?|smok(?:e[sd]?|ing) (?:an? |the )?(?:joint|hookah))\b/i,
  ],
] as const;

const motifNegation =
  /\b(?:avoid(?:ing)?|omit|exclude|no|never|without|free of|do not|don['\u2019]t|not(?! just\b| only\b))\b/i;
const conditionalMotif = /\b(?:except|if|only|unless|when|where|while)\b/i;

/** A negative list lasts to its clause boundary; keep it separate from the pictured detail. */
function motifClauses(text: string) {
  return text
    .split(/[.!?;\n]+|,\s*(?=(?:he|she|they|it|someone)\b)|\b(?:but|however|yet|then)\b/gi)
    .map((part) => {
      const negative = motifNegation.exec(part);
      return negative
        ? {
            shown: part.slice(0, negative.index),
            excluded: part.slice(negative.index + negative[0].length),
          }
        : { shown: part, excluded: "" };
    });
}

const aliasMotifs = (text: string) =>
  motifAliases.filter(([, pattern]) => pattern.test(text)).map(([motif]) => motif);
const shownMotifs = (clauses: string[]) => [...new Set(clauses.flatMap(aliasMotifs))];
const promptMotifs = (prompt: string) =>
  shownMotifs(motifClauses(prompt).map(({ shown }) => shown));

export function mentionsMotif(text: string, motif: string) {
  const alias = motifAliases.find(([name]) => name === motif)?.[1];
  return alias?.test(text) || ` ${phraseWords(text)} `.includes(` ${motif} `);
}

/** Explicit avoids and negative rules. For unrecognised concepts use only short, literal phrases. */
export function forbiddenMotifs(avoids: string[], rules: string[]) {
  const exclusions = [
    ...avoids,
    ...rules.flatMap((rule) => motifClauses(rule).map(({ excluded }) => excluded)),
  ];
  return [
    ...new Set(
      exclusions
        .filter((text) => !conditionalMotif.test(text))
        .flatMap((text) =>
          text.split(/[,;\n]+|\b(?:and|or)\b/gi).flatMap((part) => {
            const aliases = aliasMotifs(part);
            if (aliases.length) return aliases;
            const phrase = phraseWords(part.replace(motifNegation, "")).replace(
              /^(?:any|an?|the) /,
              "",
            );
            return phrase && phrase.length <= 48 && phrase.split(" ").length <= 4 ? [phrase] : [];
          }),
        ),
    ),
  ];
}

export function ideaMotifs(value: unknown, prompt = "") {
  const clauses = motifClauses(prompt);
  const shown = clauses.map((clause) => clause.shown);
  const labels = Array.isArray(value)
    ? value
        .slice(0, 5)
        .map((motif) => phraseWords(clean(motif, 48)))
        .filter(Boolean)
        .map((label) => aliasMotifs(label)[0] ?? label)
        .filter(
          (label) =>
            shown.some((part) => mentionsMotif(part, label)) ||
            !clauses.some(({ excluded }) => mentionsMotif(excluded, label)),
        )
    : [];
  return [...new Set([...shownMotifs(shown), ...labels])].slice(0, 5);
}

function recurringMotifs(history: string[][]) {
  const counts = new Map<string, number>();
  for (const idea of history)
    for (const motif of ideaMotifs(idea)) counts.set(motif, (counts.get(motif) || 0) + 1);
  return [...counts].filter(([, count]) => count >= motifFrequency).map(([motif]) => motif);
}

export function cooledMotifs(
  { motifs = [], recent }: { motifs?: string[][]; recent: string[] },
  fixed = "",
  forbidden: string[] = [],
) {
  const shown = motifClauses(fixed).map((clause) => clause.shown);
  return [
    ...new Set([
      ...recurringMotifs(motifs.slice(0, motifWindow)),
      ...recurringMotifs(recent.map(promptMotifs)),
    ]),
  ].filter(
    (motif) => forbidden.includes(motif) || !shown.some((part) => mentionsMotif(part, motif)),
  );
}

export function repeatedMotif(prompt: string, cooling: string[], motifs: string[] = []) {
  if (!cooling.length) return;
  const shown = motifClauses(prompt).map((clause) => clause.shown);
  return cooling.find(
    (motif) => motifs.includes(motif) || shown.some((part) => mentionsMotif(part, motif)),
  );
}

/** Draw away from recently used anchors as well as asking for a different concept. */
export function direction(
  { explore, feature }: { explore?: boolean; feature?: string },
  recent: string[],
  used: string[],
  hasTaste: boolean,
  random: (size: number) => number,
) {
  const words = recent.slice(0, diversity.results).map(contentWords);
  const available = Object.entries(axes).filter(
    ([axis]) => !hasTaste || (axis !== "subject" && axis !== "medium or style"),
  );
  const drawn = available.map(([axis, values]) => {
    const unused = values.filter((value) => !used.includes(`${axis}: ${value}`));
    const candidates = unused.length
      ? unused
      : [...values]
          .sort((a, b) => used.indexOf(`${axis}: ${b}`) - used.indexOf(`${axis}: ${a}`))
          .slice(0, 1);
    const scores = candidates.map((value) =>
      words.reduce((sum, used) => sum + overlap(contentWords(value), used), 0),
    );
    const least = Math.min(...scores);
    const best = candidates.filter((_, index) => scores[index] === least);
    return `${axis}: ${best[random(best.length)]}`;
  });
  return {
    anchors: drawn,
    text: [
      explore
        ? "Explore a fresh idea within their taste, using a familiar kind of subject or visual treatment in a new situation."
        : "Stay within their taste, while inventing a distinct concept.",
      ...(feature ? [`Keep this taste they like: ${feature}.`] : []),
      `Possible starting points: ${drawn.join("; ")}. Use at most one, and skip them all if none fits their taste or brief.`,
      "Choose a different subject or subject role, scene, action and composition from recent ideas. Change at least three of those dimensions; a new model, LoRA, outfit, lighting or wording alone is not a new concept.",
    ].join("\n"),
  };
}

export function similarPrompt(a: unknown, b: unknown) {
  return (
    overlap(
      contentWords(clean(a, recentPromptCharacters)),
      contentWords(clean(b, recentPromptCharacters)),
    ) > repeatOverlap
  );
}

export function freshConceptProblem(
  recent: string[],
  noveltyPrompts: string[],
  subjects: string[],
) {
  const recentWords = noveltyPrompts.map(contentWords);
  const recentSubjects = new Set(subjects.map(normalised));
  return (prompt: string, title: string, motifs: string[], cooling: string[]) => {
    const repeat = repeatedMotif(prompt, cooling, motifs);
    if (repeat) return `The optional motif "${repeat}" has appeared in several recent ideas.`;
    // Compared as remembered: shortened, as each recent prompt is.
    const head = clean(prompt, recentPromptCharacters);
    const words = contentWords(head);
    if (
      recent.some((item) => normalised(item) === normalised(head)) ||
      recentWords.some((item) => overlap(words, item) > repeatOverlap)
    )
      return "Your idea was too close to a recent or liked prompt.";
    if (title && recentSubjects.has(normalised(title)))
      return `“${title}” is a recent Dream subject.`;
    return "";
  };
}
