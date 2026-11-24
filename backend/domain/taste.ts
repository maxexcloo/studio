import { randomInt } from "node:crypto";

import type { PairAnswer } from "../../shared/dream.ts";
import {
  type TasteArea,
  type TasteAreaSetting,
  type TasteFields,
  type TasteMarkKind,
  type TasteMarks,
  type TastePreferenceChanges,
  type TastePreferences,
  type TasteWords,
  maxTastePhrase,
  maxTastePrefer,
  shapeOf,
  tasteAreasOf,
  tasteLimits,
  tasteMarkKinds,
} from "../../shared/taste.ts";
import { logWarning } from "../crash-log.js";
import {
  deleteRuntimeDocument,
  readRuntimeDocument,
  writeRuntimeDocument,
} from "../persistence/runtime.ts";
import { promptInstruction } from "./../prompt-instructions.js";
import type { DomainResponse } from "./admission.ts";
import { type RouteAccount, directRoute } from "./direct-route.ts";
import { ruleBans } from "./dream-concepts.ts";
import { agePools, likeLedger } from "./like-spread.ts";

/**
 * What a person did with a result; "like" and "dislike" rate it ("unlike" and "undislike" take a
 * rating back), "report" names an issue they asked Studio to fix, "keep" and "discard" are their
 * verdicts on Dream results,
 * "calibrate-like" and "calibrate-pass" on older gallery images Dream showed them again, "delete"
 * a finished result they deleted from the gallery, and "preferred" is a compare winner chosen over one other variant, and "pair-both" and "pair-neither"
 * answer a Dream comparison with both or neither.
 */
type TasteKind =
  | "like"
  | "unlike"
  | "dislike"
  | "undislike"
  | "report"
  | "compare"
  | "preferred"
  | "pair-both"
  | "pair-neither"
  | "iterate"
  | "keep"
  | "discard"
  | "calibrate-like"
  | "calibrate-pass"
  | "delete";
/** A LoRA a result loaded; older signals keep its name alone. */
type TasteLora = string | { name: string; strength?: number };
/** The settings a result ran with, for choices that vary them. */
interface TasteSettings {
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  width?: number;
  height?: number;
  /** Width over height, to two places. */
  aspect?: number;
  denoise?: number;
  duration?: number;
}
/**
 * The result a signal is about (`tasteChoice`): its prompt, negative and caption cut to 300
 * characters and up to eight enabled LoRAs. Older signals keep only the job, the prompt, the
 * profile and LoRA names.
 */
export interface TasteChoice {
  jobId?: string;
  itemId?: string;
  /** Image or video; older signals leave it out, and those with a duration were videos. */
  media?: "image" | "video";
  title?: string;
  /** The gallery caption. */
  caption?: string;
  prompt?: string;
  negative?: string;
  profileId?: string;
  loras?: TasteLora[];
  settings?: TasteSettings;
  seed?: string;
  tags?: string[];
  /** How Dream came to make it (`DreamOrigin.arm` in domain/dream.ts). */
  arm?: string;
  /** A Dream comparison side's value of the thing its pair varies, such as 30 for Steps. */
  value?: string | number;
}
interface TasteSignal extends TasteChoice {
  at: string;
  kind: TasteKind;
  /** For "preferred": the variant the result was liked more than, which may still be good. */
  over?: TasteChoice;
  /** For "pair-both" and "pair-neither": the comparison's other side, judged the same. */
  also?: TasteChoice;
  /** A three-way Dream comparison's remaining side. */
  third?: TasteChoice;
  /** A Dream comparison's question about the one thing its pair varies, and the answer. */
  question?: string;
  answer?: string;
  /** What that comparison varies: profile, lora, strength, steps, cfg or wording. */
  axis?: string;
  /** For "report": what was wrong, such as "Hands: six fingers". */
  issue?: string;
}
/** A job's input, or a gallery item's settings with its own fields (`itemValues`). */
type ChoiceValues = Record<string, unknown>;
/** A gallery item, as far as a signal reads it. */
interface TasteItem {
  id?: unknown;
  createdAt?: string;
  type?: unknown;
  title?: unknown;
  prompt?: unknown;
  negative?: unknown;
  width?: unknown;
  height?: unknown;
  settings?: Record<string, unknown>;
  caption?: { text?: unknown; tags?: unknown };
  dream?: { arm?: unknown; pair?: { value?: unknown } };
}
/**
 * One account's stored taste: the signals it learns from, newest first, the summariser's words and
 * the person's own preferences, which neither the summariser nor the scores change.
 */
interface StoredTaste extends TasteWords {
  preferences: TastePreferences;
  /** When the summariser last wrote. */
  updatedAt: string;
  signals: TasteSignal[];
  /** Signals recorded since the summariser last wrote. */
  since: number;
}
/** An attribute's decayed score and how many signals moved it, for how sure Studio is of it. */
interface TasteScore {
  score: number;
  /** How many likes and comparison wins raised it. */
  liked: number;
}
interface Weighted {
  score: number;
}
/** The scores read out: profiles per kind, and LoRAs with the strength that scored best. */
interface TasteReadOut {
  profiles: Record<"image" | "video", ({ id: string } & Weighted)[]>;
  loraScores: ({ name: string; strength?: number } & Weighted)[];
}
/**
 * One account's taste profile: what Studio learnt (less what the person marked or excluded), their
 * own preferences, and its scores (rebuilt from the signals on each read, so they decay with time,
 * then steered by Favourites and Less Of) read out.
 */
export interface TasteRecord extends Omit<StoredTaste, keyof TasteWords>, TasteReadOut {
  learnt: TasteFields;
  /** By attribute: `profile:<id>`, `lora:<name>@<strength>`, `tag:<tag>`, `aspect:<ratio>`, `steps:<profile>:<n>`, `cfg:<profile>:<n>`. */
  scores: Map<string, TasteScore>;
}
/**
 * What an account's text work asks for (account-policy.js `promptWriter`): where its Text runs and
 * its default model on each side.
 */
export interface PromptWriter {
  side: "cloud" | "local";
  cloud?: string;
  local?: string;
  uncensored: boolean;
  censoredOnly?: true;
}

/** The assistant gateway's chat (assistant.js), which returns its reply without reasoning. */
export interface TasteWriter<Content = string> {
  settings(): unknown;
  /**
   * The Bifrost model for a call type (assistant.js `modelFor`): where the account's `writer` runs
   * text, else the cloud model.
   */
  model(call: string, explicit?: boolean, writer?: PromptWriter): Promise<string>;
  chat(request: {
    model: string;
    /** The call type, which sets its `reasoning_effort` (assistant.js `reasoningEfforts`). */
    call: string;
    messages: { role: "system" | "user"; content: Content }[];
    temperature?: number;
    maxTokens?: number;
    timeout?: number;
    signal?: AbortSignal;
  }): Promise<{ text: string }>;
}

const maxSignals = 1000;
/** Signals past this many drop their prompt, negative and caption, keeping what the scores read. */
const maxDetailed = 200;
/** Comparison answers fill at most half the signals, so a run of them can't push out likes and keeps. */
const answerKinds = new Set<TasteKind>(["preferred", "pair-both", "pair-neither"]);
/** One action, such as a bulk like, adds at most this many signals so it can't flood the profile. */
const maxPerCall = 20;
/** Signals keep each prompt, negative and caption cut to this length. */
const maxPrompt = 300;
/**
 * The summariser also reads this many of the account's gallery likes outside Dream, drawn afresh
 * each time, so the profile follows what they like rather than what Dream showed them.
 */
const galleryLikeSample = 20;
/** The summariser reads this many of the newest signals. */
const summarySignals = 50;
/** The summariser writes after this many new signals, at most every ten minutes. */
const summariseAfter = 10;
const summariseGapMs = 10 * 60_000;
/** The longest summary of learnt taste a text model reads, in characters. */
const maxTasteSummary = 1000;
const failure = (message: string, status: number) => Object.assign(new Error(message), { status });
const instructions = () => promptInstruction("summarise-taste");
const loraText = (lora: TasteLora) =>
  typeof lora === "string"
    ? lora
    : `${lora.name}${lora.strength === undefined ? "" : ` @${lora.strength}`}`;
const details = (choice: TasteChoice) => [
  choice.profileId && `model ${choice.profileId}`,
  choice.loras?.length && `LoRAs ${choice.loras.map(loraText).join(", ")}`,
  choice.title && `title ${JSON.stringify(choice.title)}`,
  choice.prompt && `prompt ${JSON.stringify(choice.prompt)}`,
  choice.caption && `caption ${JSON.stringify(choice.caption)}`,
  choice.tags?.length && `tags ${choice.tags.join(", ")}`,
];
const describe = (signal: TasteSignal) =>
  [
    `- ${signal.kind}`,
    signal.question && `${signal.question} ${signal.answer}`,
    signal.issue && `issue ${JSON.stringify(signal.issue)}`,
    ...details(signal),
    ...(signal.over ? ["over", ...details(signal.over)] : []),
    ...(signal.also ? ["and", ...details(signal.also)] : []),
    ...(signal.third ? ["and", ...details(signal.third)] : []),
  ]
    .filter(Boolean)
    .join("; ");
function brief(signal: TasteSignal) {
  const copy = structuredClone(signal);
  for (const choice of [copy, copy.over, copy.also, copy.third])
    for (const key of ["prompt", "negative", "caption"] as const) delete choice?.[key];
  return copy;
}
const owner = (account: RouteAccount) => account?.userId || "";
const empty = (): StoredTaste => ({
  preferences: {},
  updatedAt: "",
  signals: [],
  since: 0,
  likes: [],
  styles: [],
  avoid: [],
  note: "",
});

const halfLifeMs = 60 * 86_400_000;
/**
 * How far one signal moves the score of each thing its result had. A "preferred" signal without an
 * axis is a compare winner: liked, while the variant it beat stays as it was (a relative choice,
 * no dislike). Unlike and undislike take back a rating; a report counts against what the result had.
 */
const signalWeights: Record<TasteKind, number> = {
  like: 1.5,
  unlike: -1.5,
  dislike: -1.5,
  undislike: 1.5,
  report: -1,
  compare: 1,
  preferred: 1,
  "pair-both": 0.5,
  "pair-neither": -0.5,
  iterate: 0.5,
  keep: 1,
  discard: -0.5,
  "calibrate-like": 0.5,
  "calibrate-pass": -0.5,
  delete: -1,
};
/**
 * The attributes a Dream comparison's axis covers. Its answer moves attributes that differ
 * between variants. Wording moves the caption tags they don't share.
 */
const axisAttributes: Record<string, string> = {
  profile: "profile:",
  lora: "lora:",
  strength: "lora:",
  steps: "steps:",
  cfg: "cfg:",
  wording: "tag:",
};
const roundTo = (value: number, step: number) =>
  Number((Math.round(value / step) * step).toFixed(2));
/** What a choice had, as score attributes; LoRA strengths count to 0.1 and guidance to 0.5. */
function attributes(choice: TasteChoice) {
  const profile = choice.profileId;
  const { steps, cfg, aspect } = choice.settings || {};
  return new Set(
    [
      profile && `profile:${profile}`,
      ...(choice.loras || []).map((lora) =>
        typeof lora === "string"
          ? `lora:${lora}`
          : `lora:${lora.name}${lora.strength === undefined ? "" : `@${roundTo(lora.strength, 0.1)}`}`,
      ),
      ...(choice.tags || []).map((tag) => `tag:${tag.trim().toLowerCase()}`),
      aspect && `aspect:${aspect}`,
      profile && steps && `steps:${profile}:${steps}`,
      profile && cfg !== undefined && `cfg:${profile}:${roundTo(cfg, 0.5)}`,
    ].filter((attribute): attribute is string => Boolean(attribute)),
  );
}

/** Each attribute's score from the signals, each signal halving in weight every 60 days. */
function tasteScores(signals: TasteSignal[], at: number) {
  const scores = new Map<string, TasteScore>();
  for (const signal of signals) {
    const decay = 0.5 ** (Math.max(0, at - Date.parse(signal.at)) / halfLifeMs) || 0;
    const add = (attribute: string, amount: number) => {
      const entry = scores.get(attribute) || { score: 0, liked: 0 };
      entry.score += amount * decay;
      if (amount > 0 && ["like", "compare", "preferred"].includes(signal.kind)) entry.liked += 1;
      scores.set(attribute, entry);
    };
    const other = signal.over || signal.also;
    if (signal.axis && axisAttributes[signal.axis] && other) {
      const prefix = axisAttributes[signal.axis];
      const mine = attributes(signal);
      const choices = [
        mine,
        attributes(other),
        ...(signal.third ? [attributes(signal.third)] : []),
      ];
      const counts = new Map<string, number>();
      for (const choice of choices)
        for (const attribute of choice)
          if (attribute.startsWith(prefix)) counts.set(attribute, (counts.get(attribute) || 0) + 1);
      const step = signalWeights[signal.kind];
      for (const [attribute, count] of counts) {
        if (count === choices.length) continue;
        const share = Number(mine.has(attribute));
        const preference = share - (count - share) / (choices.length - 1);
        add(attribute, signal.kind === "preferred" ? step * preference : step);
      }
      continue;
    }
    for (const attribute of new Set([
      ...attributes(signal),
      ...(signal.also ? attributes(signal.also) : []),
      ...(signal.third && !signal.over ? attributes(signal.third) : []),
    ]))
      add(attribute, signalWeights[signal.kind]);
  }
  return scores;
}

/** An attribute's family and the rest, split at its first colon. */
const head = (attribute: string) => {
  const at = attribute.indexOf(":");
  return [attribute.slice(0, at), attribute.slice(at + 1)];
};
/** What comes before an attribute's last `separator`, and the value after it. */
const split = (text: string, separator: string) => {
  const at = text.lastIndexOf(separator);
  return [text.slice(0, at), text.slice(at + 1)];
};
const byScore = (a: Weighted, b: Weighted) => b.score - a.score;
const rounded = (score: number) => Math.round(score * 100) / 100;

function readOut(signals: TasteSignal[], scores: Map<string, TasteScore>): TasteReadOut {
  const kinds = new Map<string, "image" | "video">();
  // Oldest first, so the newest signal decides a profile's kind.
  for (const signal of [...signals].reverse())
    for (const choice of [signal, signal.over, signal.also])
      if (choice?.profileId)
        kinds.set(
          choice.profileId,
          choice.media || (choice.settings?.duration ? "video" : "image"),
        );
  const profiles: TasteReadOut["profiles"] = { image: [], video: [] };
  const loras = new Map<string, { name: string; score: number; strengths: [number, number][] }>();
  for (const [attribute, { score }] of scores) {
    const [family, rest] = head(attribute);
    if (family === "profile") profiles[kinds.get(rest) || "image"].push({ id: rest, score });
    else if (family === "lora") {
      const [name, strength] = rest.includes("@") ? split(rest, "@") : [rest, ""];
      const lora = loras.get(name) || { name, score: 0, strengths: [] };
      lora.score += score;
      if (strength) lora.strengths.push([Number(strength), score]);
      loras.set(name, lora);
    }
  }
  return {
    profiles: {
      image: profiles.image
        .sort(byScore)
        .map((entry) => ({ ...entry, score: rounded(entry.score) })),
      video: profiles.video
        .sort(byScore)
        .map((entry) => ({ ...entry, score: rounded(entry.score) })),
    },
    loraScores: [...loras.values()].sort(byScore).map(({ name, score, strengths }) => {
      const [strength] = strengths.sort((a, b) => b[1] - a[1])[0] || [];
      return { name, ...(strength === undefined ? {} : { strength }), score: rounded(score) };
    }),
  };
}

/** The values of the attributes starting with `prefix` that scored above nothing, best first. */
const best = (scores: Map<string, TasteScore>, prefix: string) =>
  [...scores]
    .filter(([attribute, { score }]) => attribute.startsWith(prefix) && score > 0)
    .sort((a, b) => b[1].score - a[1].score)
    .map(([attribute]) => attribute.slice(prefix.length));

/** Score attributes' prefixes for what More and Less Like This mark. */
const markPrefixes: Record<Exclude<TasteMarkKind, "words">, string> = {
  models: "profile:",
  loras: "lora:",
  shapes: "aspect:",
  tags: "tag:",
};
/** How much a Less Of mark keeps of a liked attribute's score. */
const lessWeight = 0.25;
/**
 * Steers the scores by the person's marks: a favourite scores at least as well as the best of its
 * family, and one marked Less keeps a quarter of what it earned.
 */
function steered(scores: Map<string, TasteScore>, favourites: TasteMarks, less: TasteMarks) {
  for (const [kind, prefix] of Object.entries(markPrefixes) as [TasteMarkKind, string][]) {
    // A LoRA's attributes carry the strength it ran at.
    const of = (attribute: string, value: string) =>
      attribute === prefix + value ||
      (kind === "loras" && attribute.startsWith(`${prefix}${value}@`));
    const family = [...scores].filter(([attribute]) => attribute.startsWith(prefix));
    const top = Math.max(1, ...family.map(([, { score }]) => score));
    for (const value of favourites[kind] ?? []) {
      const own = family.filter(([attribute]) => of(attribute, value));
      if (!own.length) scores.set(prefix + value, { score: top, liked: 0 });
      for (const [attribute, entry] of own)
        scores.set(attribute, { ...entry, score: Math.max(0, entry.score) + top });
    }
    for (const value of less[kind] ?? [])
      for (const [attribute, entry] of family)
        if (of(attribute, value) && entry.score > 0)
          scores.set(attribute, { ...entry, score: entry.score * lessWeight });
  }
  return scores;
}
const sameWord = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** Whether the person marked, or excluded, a learnt value, which then shows as theirs. */
const ownedBy =
  ({ favourites = {}, less = {}, exclusions = [] }: TastePreferences, kind: TasteMarkKind) =>
  (value: string) =>
    [...(favourites[kind] ?? []), ...(less[kind] ?? []), ...exclusions].some((entry) =>
      sameWord(entry, value),
    );
/** What adopting a rule added: the bans it excluded, or the line it added to My Preferences. */
export interface Adoption {
  excluded?: string[];
  preferred?: string;
}
/** A person's view of an area of taste (Settings › Taste › Where Taste Applies). */
export interface AreaTaste {
  /** Whether the area uses what Studio learnt and My Preferences. */
  on: boolean;
  guidance: string;
  /** My Preferences, with the learnt words they asked for more of; "" while off. */
  prefer: string;
  /** What Studio learnt, in plain sentences; "" while off. */
  learnt: string;
  /** Never used, whatever the switch. */
  exclusions: string[];
}
/** An area's taste as labelled lines for a text model, Guidance first and Exclusions last. */
export const tasteLines = (taste: AreaTaste) =>
  [
    taste.guidance && `Their guidance: ${taste.guidance}`,
    taste.prefer && `Their preferences: ${taste.prefer}`,
    taste.learnt && `Their taste, as Studio learnt it: ${taste.learnt}`,
    taste.exclusions.length &&
      `Never include these or anything equivalent: ${taste.exclusions.join(", ")}`,
  ].filter((line): line is string => Boolean(line));
/** The learnt taste in plain sentences, with the three models and LoRAs that scored best. */
function summaryOf({ learnt, loraScores }: TasteRecord) {
  const loras = learnt.loras.slice(0, 3).map((name) => {
    const strength = loraScores.find((lora) => lora.name === name)?.strength;
    return `${name}${strength === undefined ? "" : ` @${strength}`}`;
  });
  return [
    learnt.likes.length && `Likes ${learnt.likes.join(", ")}.`,
    learnt.styles.length && `Styles: ${learnt.styles.join(", ")}.`,
    learnt.avoid.length && `Leans away from ${learnt.avoid.join(", ")}.`,
    learnt.models.length && `Liked models: ${learnt.models.slice(0, 3).join(", ")}.`,
    loras.length && `Liked LoRAs: ${loras.join(", ")}.`,
    learnt.note,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, maxTasteSummary);
}

/** A gallery item's values for a signal: its settings with its own prompt, size, title, tags and Dream arm. */
export function itemValues(item: TasteItem): ChoiceValues {
  return {
    ...item.settings,
    prompt: item.prompt,
    negative: item.negative,
    width: item.width || item.settings?.width,
    height: item.height || item.settings?.height,
    itemId: item.id,
    media: item.type,
    title: item.title,
    caption: item.caption?.text,
    tags: item.caption?.tags,
    ...(item.dream ? { arm: item.dream.arm, value: item.dream.pair?.value } : {}),
  };
}

/** A signal from a job's input or a gallery item's values (`itemValues`). */
export function tasteSignal(
  kind: TasteKind,
  jobId: unknown,
  values: ChoiceValues = {},
): Omit<TasteSignal, "at"> {
  return { kind, ...tasteChoice(jobId, values) };
}

/** A compare winner liked more than one other variant: a relative preference, not a dislike. */
export function preferenceSignal(
  winner: { jobId: unknown; values?: ChoiceValues },
  other: { jobId: unknown; values?: ChoiceValues },
): Omit<TasteSignal, "at"> {
  return {
    ...tasteSignal("preferred", winner.jobId, winner.values),
    over: tasteChoice(other.jobId, other.values),
  };
}

/** A gallery result as set preferences read it. */
interface SetResult {
  id: string;
  jobId?: string;
  ownerId?: string;
  status?: string;
  rating?: string;
  resultSet?: { id: string };
}
/**
 * Liking a result of an MCP set picks it from the set, like a compare vote: a preference for it
 * over each other run of the set the owner left unliked. `values` reads a result's recorded values.
 */
export function setPreferenceSignals(
  liked: SetResult[],
  gallery: SetResult[],
  values: (item: SetResult) => ChoiceValues,
): Omit<TasteSignal, "at">[] {
  return liked.flatMap((winner) => {
    const set = winner.resultSet?.id;
    if (!set) return [];
    const others = new Map<string, SetResult>();
    for (const item of gallery)
      if (
        item.resultSet?.id === set &&
        item.jobId &&
        item.jobId !== winner.jobId &&
        item.status === "done" &&
        item.rating !== "liked" &&
        (item.ownerId || "") === (winner.ownerId || "")
      )
        others.set(item.jobId, item);
    return [...others.values()].map((other) =>
      preferenceSignal(
        { jobId: winner.jobId, values: values(winner) },
        { jobId: other.jobId, values: values(other) },
      ),
    );
  });
}

/** One side of a Dream comparison: its job, recorded values and the label of what it varies. */
interface PairSide {
  jobId: unknown;
  values?: ChoiceValues;
  label: string;
}
/** Records a Dream comparison as one taste signal about its varied setting. */
export function pairSignal(
  { question, axis }: { question: string; axis?: string },
  answer: PairAnswer,
  a: PairSide,
  b: PairSide,
  c?: PairSide,
): Omit<TasteSignal, "at"> {
  const about = { question, ...(axis ? { axis } : {}) };
  if (answer === "both" || answer === "neither")
    return {
      ...tasteSignal(`pair-${answer}`, a.jobId, a.values),
      also: tasteChoice(b.jobId, b.values),
      ...(c && { third: tasteChoice(c.jobId, c.values) }),
      ...about,
      answer:
        answer === "both"
          ? c
            ? `all of ${a.label}, ${b.label} and ${c.label}`
            : `both ${a.label} and ${b.label}`
          : c
            ? `none of ${a.label}, ${b.label} or ${c.label}`
            : `neither ${a.label} nor ${b.label}`,
    };
  const sides = c ? [a, b, c] : [a, b];
  const winner = sides["abc".indexOf(answer)];
  const [other, third] = sides.filter((side) => side !== winner);
  return {
    ...preferenceSignal(winner, other),
    ...(third && { third: tasteChoice(third.jobId, third.values) }),
    ...about,
    answer: `${winner.label} over ${other.label}${third ? ` and ${third.label}` : ""}`,
  };
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const number = (value: unknown) =>
  value !== "" && value !== null && Number.isFinite(Number(value)) ? Number(value) : undefined;
const defined = <T extends object>(values: T) =>
  Object.fromEntries(
    Object.entries(values).filter(
      ([, value]) =>
        value !== undefined && value !== "" && !(Array.isArray(value) && !value.length),
    ),
  ) as Partial<T>;

function tasteSettings(values: ChoiceValues): TasteSettings | undefined {
  // An empty size, or steps a cloud model never took, is no setting.
  const positive = (value: unknown) => (number(value) || undefined) as number | undefined;
  const width = positive(values.width);
  const height = positive(values.height);
  const settings = defined({
    steps: positive(values.steps),
    cfg: number(values.cfg),
    sampler: text(values.sampler),
    scheduler: text(values.scheduler),
    width,
    height,
    aspect: width && height ? Math.round((width / height) * 100) / 100 : undefined,
    denoise: number(values.denoise),
    duration: positive(values.duration),
  });
  return Object.keys(settings).length ? settings : undefined;
}

function tasteChoice(jobId: unknown, values: ChoiceValues = {}): TasteChoice {
  const loras = (Array.isArray(values.loras) ? values.loras : [])
    .filter((lora) => typeof lora === "string" || lora?.enabled !== false)
    .map((lora) =>
      typeof lora === "string"
        ? { name: lora }
        : { name: String(lora?.name || ""), strength: number(lora?.strength) },
    )
    .filter((lora) => lora.name)
    .slice(0, 8)
    .map((lora) => defined(lora) as { name: string; strength?: number });
  const seed = text(String(values.seed ?? ""));
  const tags = (Array.isArray(values.tags) ? values.tags : []).filter(
    (tag): tag is string => typeof tag === "string" && Boolean(tag),
  );
  const value = values.value;
  return defined({
    jobId: text(jobId),
    itemId: text(values.itemId),
    media: [values.kind, values.type, values.media].find(
      (media): media is "image" | "video" => media === "image" || media === "video",
    ),
    title: text(values.title),
    caption: text(values.caption).slice(0, maxPrompt),
    prompt: text(values.prompt).slice(0, maxPrompt),
    negative: text(values.negative).slice(0, maxPrompt),
    profileId: text(values.profileId),
    loras,
    settings: tasteSettings(values),
    // A random seed was never recorded as a number.
    seed: /^\d+$/.test(seed) ? seed : undefined,
    tags,
    arm: text(values.arm),
    value: typeof value === "number" || typeof value === "string" ? value : undefined,
  });
}

/** The longest model profile id or LoRA name a taste field holds, in characters. */
const maxName = 400;
/** The longest entry a taste list field holds, in characters. */
const longestIn = (kind: string) =>
  kind === "models" || kind === "loras" ? maxName : maxTastePhrase;
/** Up to `limit` distinct, trimmed phrases of at most `longest` characters from a list. */
const phrases = (value: unknown, limit: number, longest = maxTastePhrase) =>
  [
    ...new Set(
      (Array.isArray(value) ? value : [])
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.replace(/\s+/g, " ").trim().slice(0, longest))
        .filter(Boolean),
    ),
  ].slice(0, limit);

/**
 * Per-account taste records in the runtime document store, as `taste:<ownerId>`. Scores are rebuilt
 * from the signals on every read. The text model summarises the signals into words after every ten
 * (at most every ten minutes, never while text is offline, and only while `updates` allows: the
 * Settings › Studio switch STUDIO_TASTE_UPDATES) and on request. `writer` is null where the
 * account may not send prompts to it. `areas` reads the account's saved Where Taste Applies.
 */
export function createTaste({
  dataDir,
  areas = () => undefined,
  writer = () => null,
  promptWriter = () => undefined,
  online = async () => true,
  updates = () => true,
  galleryLikes = () => [],
  now = Date.now,
}: {
  dataDir: string;
  areas?: (ownerId: string) => Partial<Record<TasteArea, Partial<TasteAreaSetting>>> | undefined;
  writer?: (ownerId: string) => TasteWriter | null;
  /** `sample` of the owner's liked gallery items outside Dream made in the range (ms), at random. */
  galleryLikes?: (
    ownerId: string,
    query: { since?: number; before?: number; sample: number },
  ) => TasteItem[];
  /** The owner's text writer (account-policy.js `promptWriter`). */
  promptWriter?: (ownerId: string) => PromptWriter | undefined;
  updates?: () => boolean;
  online?: () => Promise<boolean>;
  now?: () => number;
}) {
  const name = (ownerId: string) => `taste:${ownerId}`;
  const likeUses = likeLedger(dataDir, now);
  function load(ownerId: string): StoredTaste {
    const saved = readRuntimeDocument(dataDir, name(ownerId)) as Partial<StoredTaste> | undefined;
    if (!saved) return empty();
    const taste = { ...empty(), ...saved };
    return {
      preferences: taste.preferences,
      updatedAt: taste.updatedAt,
      signals: taste.signals,
      since: taste.since,
      likes: taste.likes,
      styles: taste.styles,
      avoid: taste.avoid,
      note: taste.note,
    };
  }
  /** The account's taste profile, its scores rebuilt from its signals as of now. */
  function read(ownerId: string): TasteRecord {
    const taste = load(ownerId);
    const { preferences } = taste;
    const scores = steered(
      tasteScores(taste.signals, now()),
      preferences.favourites ?? {},
      preferences.less ?? {},
    );
    const out = readOut(taste.signals, scores);
    const open = (kind: TasteMarkKind) => {
      const owned = ownedBy(preferences, kind);
      return (value: string) => !owned(value);
    };
    const learnt: TasteFields = {
      likes: taste.likes.filter(open("words")),
      avoid: taste.avoid.filter(open("words")),
      styles: taste.styles.filter(open("words")),
      note: taste.note,
      models: [...out.profiles.image, ...out.profiles.video]
        .filter((entry) => entry.score > 0)
        .sort(byScore)
        .map((entry) => entry.id)
        .filter(open("models"))
        .slice(0, tasteLimits.models),
      loras: out.loraScores
        .filter((lora) => lora.score > 0)
        .map((lora) => lora.name)
        .filter(open("loras"))
        .slice(0, tasteLimits.loras),
      shapes: best(scores, "aspect:").filter(open("shapes")).slice(0, tasteLimits.shapes),
      tags: best(scores, "tag:").filter(open("tags")).slice(0, tasteLimits.tags),
    };
    return {
      preferences: taste.preferences,
      updatedAt: taste.updatedAt,
      signals: taste.signals,
      since: taste.since,
      ...out,
      learnt,
      scores,
    };
  }
  const write = (ownerId: string, taste: StoredTaste) =>
    writeRuntimeDocument(dataDir, name(ownerId), taste);
  const stamp = () => new Date(now()).toISOString();
  const running = new Map<string, Promise<TasteRecord>>();
  const attempted = new Map<string, number>();
  async function summarise(ownerId: string, model: TasteWriter) {
    if (!(await online()))
      throw failure("The text model is offline. Try again once it is back.", 503);
    const before = load(ownerId);
    const drawn = likeUses
      .order(
        ownerId,
        "summary",
        await agePools(now(), (range) =>
          galleryLikes(ownerId, { ...range, sample: galleryLikeSample }),
        ),
        randomInt,
      )
      .slice(0, galleryLikeSample);
    const liked = drawn.map(
      (item) =>
        `- gallery like; ${details(tasteChoice(undefined, itemValues(item)))
          .filter(Boolean)
          .join("; ")}`,
    );
    if (!before.signals.length && !liked.length)
      throw failure("Like, compare or iterate on a few results first.", 400);
    attempted.set(ownerId, now());
    const recent = before.signals.slice(0, summarySignals);
    const { favourites = {}, less = {} } = before.preferences;
    let text: string;
    try {
      ({ text } = await model.chat({
        call: "taste",
        model: await model.model("taste", false, promptWriter(ownerId)),
        messages: [
          { role: "system", content: instructions() },
          {
            role: "user",
            content: [
              "Recent signals, newest first:",
              ...(recent.length ? recent.map(describe) : ["(none)"]),
              "",
              "Gallery likes, sampled from their whole history:",
              ...(liked.length ? liked : ["(none)"]),
              ...(favourites.words?.length
                ? ["", `They asked for more of: ${favourites.words.join(", ")}`]
                : []),
              ...(less.words?.length
                ? ["", `They asked for less of: ${less.words.join(", ")}`]
                : []),
            ].join("\n"),
          },
        ],
        temperature: 0.3,
        maxTokens: 2000,
        timeout: 60_000,
      }));
    } catch (error) {
      const reason = (error as { reason?: string }).reason || "unreachable";
      throw failure(`The text model couldn't write the taste profile (${reason}).`, 502);
    }
    let reply: Partial<Record<keyof TasteWords, unknown>> | null;
    try {
      reply = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] || "");
    } catch {
      reply = null;
    }
    const words: TasteWords = {
      likes: phrases(reply?.likes, tasteLimits.likes),
      avoid: phrases(reply?.avoid, tasteLimits.avoid),
      styles: phrases(reply?.styles, tasteLimits.styles),
      note:
        typeof reply?.note === "string"
          ? reply.note.replace(/\s+/g, " ").trim().slice(0, tasteLimits.note)
          : "",
    };
    if (!words.likes.length && !words.styles.length && !words.note)
      throw failure("The text model's reply was unusable. Try again.", 502);
    const current = load(ownerId);
    // A Clear while the model wrote wins over its reply.
    if (current.since < before.since || (before.signals.length && !current.signals.length))
      return read(ownerId);
    write(ownerId, {
      ...current,
      ...words,
      updatedAt: stamp(),
      since: current.since - before.since,
    });
    likeUses.used(
      ownerId,
      "summary",
      drawn.map((item) => item.id),
    );
    return read(ownerId);
  }
  /** Summarises the signals now; one summary runs per account at a time. */
  function refresh(ownerId: string) {
    const model = writer(ownerId);
    if (!model)
      return Promise.reject(
        failure(
          "Taste can't refresh: no assistant is configured, or this account can't use it.",
          403,
        ),
      );
    let job = running.get(ownerId);
    if (!job) {
      job = summarise(ownerId, model).finally(() => running.delete(ownerId));
      running.set(ownerId, job);
    }
    return job;
  }
  /** Sets the person's own preferences; null clears one. */
  function edit(ownerId: string, changes: TastePreferenceChanges) {
    const current = load(ownerId);
    const preferences = { ...current.preferences };
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) delete preferences[key as keyof TastePreferences];
      else Object.assign(preferences, { [key]: value });
    }
    write(ownerId, { ...current, preferences });
    return read(ownerId);
  }
  return {
    read,
    /**
     * What `area` receives of the account's taste: Exclusions and its guidance always, what Studio
     * learnt and My Preferences while its switch is on. Pass a `record` already read to reuse it.
     */
    area(ownerId: string, area: TasteArea, record?: TasteRecord): AreaTaste {
      const { taste: on, guidance } = tasteAreasOf(areas(ownerId))[area];
      const { preferences } = record ?? load(ownerId);
      const exclusions = preferences.exclusions ?? [];
      if (!on) return { on, guidance, prefer: "", learnt: "", exclusions };
      const more = [
        ...(preferences.favourites?.words ?? []),
        ...(preferences.favourites?.tags ?? []),
      ];
      return {
        on,
        guidance,
        prefer: [preferences.prefer, more.length && `More of ${more.join(", ")}.`]
          .filter(Boolean)
          .join(" "),
        learnt: summaryOf(record ?? read(ownerId)),
        exclusions,
      };
    },
    refresh,
    /**
     * Forgets the learnt words, keeping the signals and the person's own preferences, then rebuilds them
     * from the signals where the account may use the text model.
     */
    resetLearnt(ownerId: string) {
      const current = load(ownerId);
      if (current.likes.length || current.styles.length || current.avoid.length || current.note)
        write(ownerId, { ...current, likes: [], styles: [], avoid: [], note: "", updatedAt: "" });
      return writer(ownerId) ? refresh(ownerId) : Promise.resolve(read(ownerId));
    },
    /** Whether the text model may write this account's profile. */
    writable: (ownerId: string) => Boolean(writer(ownerId)),
    /** Adds one action's signals newest first. An atomic judgement requires the write to succeed. */
    record(ownerId: string, all: Omit<TasteSignal, "at">[], strict = false) {
      const signals = all.slice(0, maxPerCall);
      if (!signals.length) return;
      try {
        const taste = load(ownerId);
        const at = stamp();
        let answers = 0;
        taste.signals = [
          ...signals.map((signal) => ({ at, ...signal })).reverse(),
          ...taste.signals,
        ]
          .filter((signal) => !answerKinds.has(signal.kind) || ++answers <= maxSignals / 2)
          .slice(0, maxSignals)
          .map((signal, index) => (index < maxDetailed ? signal : brief(signal)));
        taste.since += signals.length;
        write(ownerId, taste);
        // Best effort in the background; the request that added the signal never waits.
        if (
          taste.since >= summariseAfter &&
          !running.has(ownerId) &&
          now() - (attempted.get(ownerId) ?? -Infinity) >= summariseGapMs &&
          updates() &&
          writer(ownerId)
        )
          void refresh(ownerId).catch(() => undefined);
      } catch (error) {
        if (strict) throw error;
        logWarning(`A taste signal was not saved: ${(error as Error).message}`);
      }
    },
    /** Takes back what an undone judgement taught: the signals about `jobIds` from `since` on. */
    takeBack(ownerId: string, jobIds: string[], since: string) {
      const taste = load(ownerId);
      const about = (signal: TasteSignal) =>
        [signal.jobId, signal.over?.jobId, signal.also?.jobId, signal.third?.jobId].some(
          (jobId) => jobId && jobIds.includes(jobId),
        );
      const signals = taste.signals.filter((signal) => !(signal.at >= since && about(signal)));
      const dropped = taste.signals.length - signals.length;
      if (dropped) write(ownerId, { ...taste, signals, since: Math.max(0, taste.since - dropped) });
    },
    exclusions: (ownerId: string) => load(ownerId).preferences.exclusions ?? [],
    /**
     * Adopts a rule an issue suggests (domain/inbox.ts): one that only bans things adds those not
     * yet excluded to Exclusions, any other joins My Preferences on its own line. Returns what it
     * added, which `unadopt` takes back.
     */
    adopt(ownerId: string, rule: string): Adoption {
      const { preferences } = load(ownerId);
      const bans = ruleBans(rule);
      if (bans) {
        const had = preferences.exclusions ?? [];
        const excluded = bans.filter((ban) => !had.some((entry) => sameWord(entry, ban)));
        if (had.length + excluded.length > tasteLimits.exclusions)
          throw failure(`Exclusions are full at ${tasteLimits.exclusions}: remove one first.`, 400);
        edit(ownerId, { exclusions: [...had, ...excluded] });
        return { excluded };
      }
      const prefer = [preferences.prefer, rule].filter(Boolean).join("\n");
      if (prefer.length > maxTastePrefer)
        throw failure("My Preferences are full: shorten them first.", 400);
      edit(ownerId, { prefer });
      return { preferred: rule };
    },
    /** Whether a rule is already adopted: its bans all excluded, or its line in My Preferences. */
    adopted(ownerId: string, rule: string) {
      const { preferences } = load(ownerId);
      const bans = ruleBans(rule);
      const has = (list: string[], value: string) => list.some((entry) => sameWord(entry, value));
      return bans
        ? bans.every((ban) => has(preferences.exclusions ?? [], ban))
        : has((preferences.prefer ?? "").split("\n"), rule);
    },
    /** Takes back only what adopting a rule added. */
    unadopt(ownerId: string, { excluded = [], preferred }: Adoption) {
      const { preferences } = load(ownerId);
      const lines = (preferences.prefer ?? "").split("\n");
      const line = preferred === undefined ? -1 : lines.lastIndexOf(preferred);
      return edit(ownerId, {
        ...(excluded.length && {
          exclusions: (preferences.exclusions ?? []).filter((entry) => !excluded.includes(entry)),
        }),
        ...(line >= 0 && { prefer: lines.filter((_, index) => index !== line).join("\n") }),
      });
    },
    edit,
    forget(ownerId: string) {
      deleteRuntimeDocument(dataDir, name(ownerId));
    },
  };
}
export type Taste = ReturnType<typeof createTaste>;

/** The caller's own taste profile: read, edit preferences, summarise and forget. */
export function registerTasteRoutes(
  app: object,
  {
    taste,
    adminRefusal,
  }: {
    taste: Taste;
    /** route-access.js's: why the account may not, or null. */
    adminRefusal(account: RouteAccount): DomainResponse | null;
  },
) {
  const show = (ownerId: string, record: TasteRecord) => ({
    status: 200,
    payload: {
      learnt: record.learnt,
      preferences: record.preferences,
      loraScores: record.loraScores,
      updatedAt: record.updatedAt,
      signals: record.signals.length,
      writer: taste.writable(ownerId),
    },
  });
  /** A list of up to `limit` distinct entries of at most `longest` characters (shapes as ratios). */
  const list = (value: unknown, limit: number, longest: number, shapes = false) =>
    Array.isArray(value) &&
    value.length <= limit &&
    value.every(
      (entry) =>
        typeof entry === "string" &&
        entry.trim().length <= longest &&
        (!shapes || (Number.isFinite(Number(entry)) && Number(entry) > 0)),
    );
  const marks = (value: unknown) =>
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value as object).every(
      ([kind, entries]) =>
        (tasteMarkKinds as readonly string[]).includes(kind) &&
        list(entries, tasteLimits[kind as TasteMarkKind], longestIn(kind), kind === "shapes"),
    );
  /** Whether a preference's value fits it: null clears it. */
  const fits = (key: string, value: unknown) =>
    value === null ||
    (key === "prefer" && typeof value === "string" && value.length <= maxTastePrefer) ||
    (key === "exclusions" && list(value, tasteLimits.exclusions, maxTastePhrase)) ||
    ((key === "favourites" || key === "less") && marks(value));
  const cleanList = (kind: string, value: string[]) =>
    kind === "shapes"
      ? [...new Set(value.map((shape) => shapeOf(Number(shape))))]
      : phrases(
          kind === "tags" ? value.map((tag) => tag.toLowerCase()) : value,
          value.length,
          longestIn(kind),
        );
  /** Answers with the owner's profile once `work` settles, or why it failed. */
  const settle = async (ownerId: string, work: Promise<TasteRecord>) => {
    try {
      return show(ownerId, await work);
    } catch (error) {
      const { status = 500, message } = error as Error & { status?: number };
      return { status, payload: { ok: false, error: message } };
    }
  };
  directRoute(app, "GET", "/api/taste", (account) =>
    show(owner(account), taste.read(owner(account))),
  );
  directRoute(app, "PUT", "/api/taste", (account, { body }) => {
    const preferences = body?.preferences;
    if (
      !preferences ||
      typeof preferences !== "object" ||
      Array.isArray(preferences) ||
      !Object.entries(preferences).every(([key, value]) => fits(key, value))
    )
      return { status: 400, payload: { ok: false, error: "Supply valid taste preferences." } };
    const clean = Object.fromEntries(
      Object.entries(preferences as Record<string, unknown>).map(([key, value]) => [
        key,
        value === null || typeof value === "string"
          ? (value as string | null)?.trim() || null
          : Array.isArray(value)
            ? cleanList(key, value)
            : Object.fromEntries(
                Object.entries(value as TasteMarks).map(([kind, entries]) => [
                  kind,
                  cleanList(kind, entries),
                ]),
              ),
      ]),
    );
    return show(owner(account), taste.edit(owner(account), clean));
  });
  directRoute(app, "POST", "/api/taste/refresh", (account) =>
    settle(owner(account), taste.refresh(owner(account))),
  );
  directRoute(app, "POST", "/api/taste/reset", (account) =>
    settle(owner(account), taste.resetLearnt(owner(account))),
  );
  // Administrators only (Settings › Users): another account's Reset Learnt Taste.
  directRoute(app, "POST", "/api/taste/owners/:id/reset", (account, { params }) => {
    const refusal = adminRefusal(account);
    if (refusal) return refusal;
    return settle(params.id, taste.resetLearnt(params.id));
  });
  directRoute(app, "DELETE", "/api/taste", (account) => {
    taste.forget(owner(account));
    return show(owner(account), taste.read(owner(account)));
  });
}
