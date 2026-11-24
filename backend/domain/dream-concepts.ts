import { promptInstruction } from "../prompt-instructions.js";

/**
 * Dream's latest this many image results set its diversity budget: a profile or LoRA weighs less by
 * the share of them it took (to no less than `floor`), and results at least `alike` like another
 * by image are named to the writer as ground to move away from.
 */
export const diversity = { results: 20, floor: 0.2, alike: 0.9 };
export const motifWindow = 12;
export const recentPromptCharacters = 1000;
const motifFrequency = 2;
/** A word shared by this many recent ideas' motif labels recurs, as a whole label does at two. */
const motifWordFrequency = 3;
/** Words too general to cool on their own, though labels holding them still count whole. */
const generalMotifWords = new Set(
  "background clothing color colors colour light lighting outfit palette photo photograph portrait scene shot style tone tones wear".split(
    " ",
  ),
);
/**
 * Look terms over Dream's latest `window` prompts: one in at least `share` of them (and `least`
 * times) is in fashion, and an idea reusing more than `reuse` of those repeats the look. Words in
 * at least `boilerplate` of the recent prompts are a fixed style clause, not the idea.
 */
export const looks = { window: 30, share: 0.25, least: 3, reuse: 2, boilerplate: 0.5 };

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
  genre: [
    "a documentary moment",
    "a fashion editorial",
    "film noir",
    "a heist",
    "a road trip",
    "a romantic comedy",
    "science fiction",
    "a sports story",
    "a thriller",
    "travel photography",
    "a western",
    "wildlife photography",
  ],
  interaction: [
    "a game or contest",
    "a performer and their audience",
    "a reunion",
    "a rivalry",
    "a shared secret",
    "making up after an argument",
    "helping a stranger",
    "sharing a meal",
    "strangers meeting by chance",
    "teaching someone a skill",
    "a quiet moment alone",
    "working side by side",
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
    "a train carriage",
    "a ferry deck",
    "a greenhouse",
    "a stadium",
    "a library",
    "a workshop or garage",
  ],
  outfit: [
    "everyday casualwear",
    "tailored formalwear",
    "sportswear",
    "a work uniform",
    "traditional dress",
    "vintage clothing",
    "streetwear",
    "evening wear",
    "swimwear",
    "outdoor gear",
    "layered winter clothing",
    "loungewear",
  ],
  look: [
    "short cropped hair",
    "long loose hair",
    "braided hair",
    "curly hair",
    "an unusual hair color",
    "freckles",
    "glasses",
    "tattoos",
    "bold makeup",
    "a bare, natural face",
    "a different build",
    "striking jewelry",
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
  capture: [
    "a candid phone snapshot",
    "direct on-camera flash",
    "35mm color film",
    "black-and-white film",
    "medium-format film",
    "a disposable camera",
    "soft window light",
    "a long-lens street candid",
    "an instant photo",
    "a crisp digital editorial shot",
    "a high-speed sports frame",
    "a medium-format studio portrait",
    "a security or webcam still",
    "a tilt-shift miniature look",
    "infrared film",
    "a wet-plate or tintype portrait",
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
/**
 * The looks Dream drifts towards: colors, garments, light, expressions and camera quirks. Plain
 * black, white, grey and brown describe hair and everyday things too often to tell a look.
 */
const lookTerms: Record<string, string[]> = {
  color:
    "amber apricot beige blush burgundy camel caramel charcoal chocolate cobalt coral cream crimson emerald espresso fuchsia gold ivory khaki lavender lilac magenta maroon mauve mint mocha mustard navy ochre olive orange peach pink plum purple red rust saffron sage scarlet silver tan taupe teal terracotta turquoise violet wine yellow".split(
      " ",
    ),
  garment: [
    ..."blazer bodysuit bomber boots bralette bustier camisole cardigan corduroy corset denim fishnet halter heels hoodie jeans knit lace latex leather leggings linen lingerie mesh miniskirt overalls puffer ribbed satin sequin sheer silk stockings sundress sweater sweatshirt turtleneck velvet".split(
      " ",
    ),
    "cargo pants",
    "crop top",
    "pleated skirt",
    "slip dress",
    "tank top",
    "trench coat",
    "tube top",
    "zip-front",
  ],
  light: [
    ..."backlit candlelight dappled dusk fluorescent halogen lamplight moonlight neon overcast sodium spotlight strobe sunset tungsten twilight".split(
      " ",
    ),
    "blue hour",
    "fairy lights",
    "golden hour",
    "on-camera flash",
    "ring light",
    "string lights",
    "window light",
  ],
  expression: [
    ..."bored calm coy deadpan dreamy grin laughing mischievous pensive playful pout serene sly smirk sultry wistful wry".split(
      " ",
    ),
    "closed-lip smile",
    "knowing look",
    "soft smile",
  ],
  camera: [
    ..."grain grainy halation off-level overexposed underexposed vignette".split(" "),
    "lens flare",
    "light leak",
    "motion blur",
    "soft focus",
    "tilted horizon",
  ],
};
const lookPatterns = Object.values(lookTerms)
  .flat()
  .map((term) => [term, ` ${phraseWords(term)} `, ` ${phraseWords(term)}s `] as const);
/** The look terms a prompt uses. */
export function lookTermsIn(prompt: string) {
  const words = ` ${phraseWords(prompt)} `;
  return lookPatterns
    .filter(([, one, more]) => words.includes(one) || words.includes(more))
    .map(([term]) => term);
}
/**
 * The look terms in fashion over the latest prompts, most used first, leaving out those the fixed
 * brief or rules use.
 */
export function fashionableLooks(prompts: string[], fixed = "") {
  const latest = prompts.slice(0, looks.window);
  const required = new Set(lookTermsIn(fixed));
  const counts = new Map<string, number>();
  for (const prompt of latest)
    for (const term of lookTermsIn(prompt)) counts.set(term, (counts.get(term) || 0) + 1);
  return [...counts]
    .filter(
      ([term, count]) =>
        !required.has(term) && count >= looks.least && count / latest.length >= looks.share,
    )
    .sort((a, b) => b[1] - a[1])
    .map(([term]) => term);
}

const stopWords = new Set(
  "a an and are as at be by for from in into is it its of on or over the their there these this to under while with without".split(
    " ",
  ),
);
const contentWords = (text: string) =>
  new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((word) => !stopWords.has(word)),
  );
/** Words in at least `looks.boilerplate` of several recent prompts: a fixed clause, not the idea. */
export function boilerplate(prompts: string[]) {
  if (prompts.length < 4) return new Set<string>();
  const counts = new Map<string, number>();
  for (const prompt of prompts)
    for (const word of contentWords(prompt)) counts.set(word, (counts.get(word) || 0) + 1);
  return new Set(
    [...counts]
      .filter(([, count]) => count / prompts.length >= looks.boilerplate)
      .map(([word]) => word),
  );
}
/**
 * A prompt without its opening sentences that are mostly `common` words, such as a style clause
 * every prompt repeats; its last sentence always stays.
 */
export function promptBody(prompt: string, common: Set<string>) {
  const sentences = prompt.split(/(?<=[.!?])\s+/);
  let start = 0;
  while (start < sentences.length - 1) {
    const words = [...contentWords(sentences[start])];
    if (words.length && words.filter((word) => common.has(word)).length / words.length < 0.7) break;
    start++;
  }
  return sentences.slice(start).join(" ");
}
/** Jaccard overlap of two word sets. */
function overlap(a: Set<string>, b: Set<string>) {
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  const union = a.size + b.size - shared;
  return union ? shared / union : 0;
}
const stem = (word: string) => word.replace(/men$/, "man").replace(/([^s])s$/, "$1");
/** Whether a prompt shares no word with a brief's subjects, so it can't be showing them. */
export function missesSubjects(prompt: string, subjects: string) {
  const wanted = new Set([...contentWords(subjects)].map(stem));
  return wanted.size > 0 && ![...contentWords(prompt)].some((word) => wanted.has(stem(word)));
}
/**
 * How the latest `count` prompts open: each one's first eight words, which the shared style
 * clause leaves out of the recent prompts the writer sees, so a stock opening would go unseen.
 */
export const recentOpenings = (prompts: string[], count: number) => [
  ...new Set(
    prompts
      .slice(0, count)
      .map((prompt) => clean(prompt, 200).split(" ").slice(0, 8).join(" "))
      .filter(Boolean),
  ),
];
/** A short subject for an idea: its title, else its opening words. */
export const subjectOf = (title: unknown, prompt: unknown) =>
  clean(title, 80) || clean(prompt, 400).split(" ").slice(0, 6).join(" ");

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

export const mentionsMotif = (text: string, motif: string) =>
  ` ${phraseWords(text)} `.includes(` ${phraseWords(motif)} `);

/** The first excluded motif a prompt names at all: an image model draws what it names, even after "no". */
export const namedMotif = (prompt: string, forbidden: string[]) =>
  forbidden.find((motif) => mentionsMotif(prompt, motif));

/**
 * Explicit avoids and negative rules, as short literal phrases.
 * `unasked` (Dream, which takes no requests) keeps a rule's exclusion before "unless".
 */
export function forbiddenMotifs(avoids: string[], rules: string[], unasked = false) {
  const exclusions = [
    ...avoids,
    ...rules.flatMap((rule) => motifClauses(rule).map(({ excluded }) => excluded)),
  ];
  return [
    ...new Set(
      exclusions
        .map((text) => (unasked ? text.split(/\bunless\b/i)[0] : text))
        .filter((text) => !conditionalMotif.test(text))
        .flatMap((text) =>
          // "black and white photos" is one phrase, so "and" never separates items; "or" does.
          text.split(/[,;\n]+|\bor\b/gi).flatMap((part) => {
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

/** The user's own exclusions as phrases; the writer judges what else is equivalent. */
export const explicitExclusions = (entries: string[]) => [
  ...new Set(entries.map(phraseWords).filter(Boolean)),
];

export function ideaMotifs(value: unknown, prompt = "") {
  const clauses = motifClauses(prompt);
  const shown = clauses.map((clause) => clause.shown);
  const labels = Array.isArray(value)
    ? value
        .slice(0, 5)
        .map((motif) => phraseWords(clean(motif, 48)))
        .filter(Boolean)
        .filter(
          (label) =>
            shown.some((part) => mentionsMotif(part, label)) ||
            !clauses.some(({ excluded }) => mentionsMotif(excluded, label)),
        )
    : [];
  return [...new Set(labels)];
}

/** Labels in at least two ideas, and their words in at least three (as "amber" in "amber glow"). */
function recurringMotifs(history: string[][]) {
  const counts = new Map<string, number>();
  const words = new Map<string, number>();
  for (const idea of history) {
    const motifs = ideaMotifs(idea);
    for (const motif of motifs) counts.set(motif, (counts.get(motif) || 0) + 1);
    for (const word of new Set(motifs.flatMap((motif) => [...contentWords(motif)])))
      if (word.length > 2 && !generalMotifWords.has(word))
        words.set(word, (words.get(word) || 0) + 1);
  }
  return [
    ...new Set([
      ...[...counts].filter(([, count]) => count >= motifFrequency).map(([motif]) => motif),
      ...[...words].filter(([, count]) => count >= motifWordFrequency).map(([word]) => word),
    ]),
  ];
}

/**
 * Optional motifs to leave out of a new idea: those recurring in recent ideas and those of ideas
 * passed as too similar (`paused`), unless the fixed brief or rules show them.
 */
export function cooledMotifs(
  { motifs = [] }: { motifs?: string[][] },
  fixed = "",
  forbidden: string[] = [],
  paused: string[] = [],
) {
  const shown = motifClauses(fixed).map((clause) => clause.shown);
  return [...new Set([...recurringMotifs(motifs.slice(0, motifWindow)), ...paused])].filter(
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

/** What an idea changes first, in turn, so successive ideas differ along different lines. */
const varied = [
  "palette: the colors and tones",
  "garments: what people wear and its fabrics",
  "light: the light source, its direction and color",
  "expression: faces and mood",
  "setting: where it happens",
  "framing: the camera's distance, angle and lens",
];

/**
 * Draw away from recently used anchors as well as asking for a different concept, never towards
 * what is excluded (`forbidden`). With a taste profile, the photographic capture stands in for
 * medium, and for subject too unless the idea explores fresh ground; `vary` is the dimension the
 * idea changes first. A project's idea (`briefed`) keeps the brief's subjects and styles, so it
 * varies only what the brief leaves open.
 */
export function direction(
  { explore, feature }: { explore?: boolean; feature?: string },
  recent: string[],
  used: string[],
  hasTaste: boolean,
  random: (size: number) => number,
  briefed = false,
  forbidden: string[] = [],
) {
  const words = recent.slice(0, diversity.results).map(contentWords);
  const available = Object.entries({ ...axes, ...(briefed ? {} : { vary: varied }) }).filter(
    ([axis]) =>
      briefed
        ? !["capture", "medium or style", "subject"].includes(axis)
        : hasTaste
          ? axis !== "medium or style" && (explore || axis !== "subject")
          : axis !== "capture",
  );
  const draws = available.flatMap(([axis, all]) => {
    const values = all.filter((value) => !forbidden.some((motif) => mentionsMotif(value, motif)));
    if (!values.length) return [];
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
    return [`${axis}: ${best[random(best.length)]}`];
  });
  const drawn = draws.filter((anchor) => !anchor.startsWith("vary: "));
  const vary = draws.find((anchor) => anchor.startsWith("vary: "));
  return {
    anchors: vary ? [...drawn, vary] : drawn,
    vary: vary?.slice("vary: ".length),
    text: briefed
      ? promptInstruction("project-diversity", { startingPoints: drawn.join("; ") })
      : promptInstruction("dream-diversity", {
          tasteDirection: promptInstruction(explore ? "explore-dream-taste" : "follow-dream-taste"),
          featuredTaste: feature ? promptInstruction("feature-dream-taste", { feature }) : "",
          startingPoints: drawn.join("; "),
        }),
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

/**
 * Why a new idea repeats a recent one, or "". Words of the fixed brief and rules (`fixed`), which
 * every prompt may repeat, don't count towards likeness.
 */
export function freshConceptProblem(
  recent: string[],
  noveltyPrompts: string[],
  subjects: string[],
  fixed = "",
  fashionable: string[] = [],
) {
  const shared = new Set([...contentWords(fixed), ...boilerplate(recent)]);
  const varying = (text: string) =>
    new Set([...contentWords(text)].filter((word) => !shared.has(word)));
  const recentWords = noveltyPrompts.map(varying);
  const recentSubjects = new Set(subjects.map(normalised));
  return (prompt: string, title: string, motifs: string[], cooling: string[]) => {
    const repeat = repeatedMotif(prompt, cooling, motifs);
    if (repeat) return `The optional motif "${repeat}" has appeared in several recent ideas.`;
    const reused = lookTermsIn(prompt).filter((term) => fashionable.includes(term));
    if (reused.length > looks.reuse)
      return `It reuses ${reused.join(", ")}, as many recent ideas do; choose other colors, garments, light, expressions and camera details.`;
    // Compared as remembered: shortened, as each recent prompt is.
    const head = clean(prompt, recentPromptCharacters);
    const words = varying(head);
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
