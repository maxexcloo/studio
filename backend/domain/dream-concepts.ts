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
/** Words in at least this share of the recent prompts are a fixed style clause, not the idea. */
const boilerplateShare = 0.5;

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

const stopWords = new Set(
  "a an and are as at be by for from in into is it its of on or over the their there these this to under while with without".split(
    " ",
  ),
);
const contentWords = (text: string) =>
  new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((word) => !stopWords.has(word)),
  );
/** Words in at least `boilerplateShare` of several recent prompts: a fixed clause, not the idea. */
export function boilerplate(prompts: string[]) {
  if (prompts.length < 4) return new Set<string>();
  const counts = new Map<string, number>();
  for (const prompt of prompts)
    for (const word of contentWords(prompt)) counts.set(word, (counts.get(word) || 0) + 1);
  return new Set(
    [...counts]
      .filter(([, count]) => count / prompts.length >= boilerplateShare)
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
            negation: negative[0],
          }
        : { shown: part, excluded: "", negation: "" };
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

/** Literal user exclusions as motifs. */
export const explicitExclusions = (entries: string[]) => [
  ...new Set(entries.map(phraseWords).filter(Boolean)),
];

/** Negations that take a thing ("no CGI"), where "never" and "don't" usually take an action. */
const thingNegation = /^(?:avoid(?:ing)?|omit|exclude|no|without|free of)$/i;
/**
 * A rule's bans where it does nothing but ban things ("no smoking or tattoos", "without CGI"), else
 * null: a rule that also asks for something, makes an exception or bans an action ("never show
 * feet") is a preference.
 */
export function ruleBans(rule: string) {
  const clauses = motifClauses(rule).filter(
    ({ shown, excluded }) => phraseWords(shown) || phraseWords(excluded),
  );
  if (
    !clauses.length ||
    clauses.some(
      ({ shown, excluded, negation }) =>
        phraseWords(shown) || !thingNegation.test(negation) || conditionalMotif.test(excluded),
    )
  )
    return null;
  const bans = clauses.flatMap(({ excluded }) =>
    excluded
      .split(/[,;]+|\b(?:or|nor)\b/gi)
      .map((part) => phraseWords(part).replace(/^(?:any|an?|the) /, ""))
      .filter(Boolean),
  );
  return bans.length && bans.every((ban) => ban.split(" ").length <= 4) ? [...new Set(bans)] : null;
}

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
/**
 * How a new idea moves away from the recent ones. A project's idea (`briefed`) keeps the brief's
 * subjects and styles, so it varies only what the brief leaves open.
 */
export const direction = (
  { explore, feature }: { explore?: boolean; feature?: string },
  briefed: boolean,
) =>
  briefed
    ? promptInstruction("project-diversity")
    : promptInstruction("dream-diversity", {
        tasteDirection: promptInstruction(explore ? "explore-dream-taste" : "follow-dream-taste"),
        featuredTaste: feature ? promptInstruction("feature-dream-taste", { feature }) : "",
      });

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
) {
  const shared = new Set([...contentWords(fixed), ...boilerplate(recent)]);
  const varying = (text: string) =>
    new Set([...contentWords(text)].filter((word) => !shared.has(word)));
  const recentWords = noveltyPrompts.map(varying);
  const recentSubjects = new Set(subjects.map(normalised));
  return (prompt: string, title: string, motifs: string[], cooling: string[]) => {
    const repeat = repeatedMotif(prompt, cooling, motifs);
    if (repeat) return `The optional motif "${repeat}" has appeared in several recent ideas.`;
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
