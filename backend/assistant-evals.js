// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The prompt assistant's eval set (backend/fixtures/assistant-evals/) and its deterministic scorer.
 * CI replays the recorded replies through the engine (assistant-evals.test.js); `mise run
 * eval:assistant` replays the same cases against the live gateway on demand (backend/commands/assistant-eval.mjs).
 *
 *   rewrite.json   prompts per preset: subjects and quoted text kept, no setting words, preset tone
 *   loras.json     prompts against a frozen catalogue snapshot: expected and forbidden LoRAs
 *   negative.json  negatives: unused where the guide says so, wanted terms, no prompt subjects
 *   animate.json   motion prompts per profile shape: the guide's sections or none, camera, sound
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAssistant } from "./assistant.js";
import { settingWords } from "./assistant-presets.js";
import { animateFiller, writeAnimatePrompt } from "./prompt-animate.js";

export const evalsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "assistant-evals",
);
export const loadEvals = (dir = evalsDir) =>
  Object.fromEntries(
    ["rewrite", "loras", "negative", "animate"].map((name) => [
      name,
      JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8")),
    ]),
  );

const lower = (value) => String(value || "").toLowerCase();
const wordCount = (value) => (String(value || "").match(/[\p{L}\p{N}'’-]+/gu) || []).length;
const hasPhrase = (text, phrase) =>
  new RegExp(
    `(^|[^\\p{L}\\p{N}])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`,
    "iu",
  ).test(text);
/** Text inside straight or curly double quotes. */
const quotedText = (value) =>
  [...String(value || "").matchAll(/["“]([^"”]+)["”]/g)].map((match) => match[1]);

// Words that show a preset's tone; a rewrite needs at least one (cases may give their own).
const tones = {
  candid: ["candid", "unposed", "everyday", "natural light", "daylight", "window light", "mid-"],
  cinematic: [
    "film",
    "cinematic",
    "still",
    "frame",
    "grade",
    "graded",
    "shot",
    "anamorphic",
    "widescreen",
  ],
  illustration: [
    "illustration",
    "illustrated",
    "watercolour",
    "ink",
    "gouache",
    "vector",
    "painted",
    "linework",
  ],
  portrait: ["portrait", "close-up", "face", "expression", "eyes", "lens", "depth of field"],
  product: ["product", "studio", "backdrop", "softbox", "key light", "rim light", "surface"],
  spicy: ["sensual", "sultry", "bare", "intimate", "lingerie", "seductive", "skin"],
};

/** Scores one rewrite: a list of named checks, each passed or not. */
export function scoreRewrite(item, output) {
  const text = String(output || "");
  const expect = item.expect || {};
  const checks = [];
  const check = (name, ok, detail = "") =>
    checks.push({ name, ok: Boolean(ok), ...(ok || !detail ? {} : { detail }) });
  check(
    "written",
    text.trim() && lower(text.trim()) !== lower(item.prompt.trim()),
    "Unchanged or empty",
  );
  check(
    "no preamble",
    !/^(here(?:'s| is)|sure|certainly|rewritten prompt)\b/i.test(text.trim()),
    text.slice(0, 40),
  );
  for (const phrase of expect.keep || [])
    check(`keeps "${phrase}"`, hasPhrase(text, phrase), "Missing");
  for (const quote of quotedText(item.prompt))
    check(`quotes "${quote}" exactly`, text.includes(quote), "Quoted text changed");
  const settings = settingWords.filter((word) => hasPhrase(text, word));
  check("no setting words", !settings.length, settings.join(", "));
  for (const word of expect.avoid || [])
    check(`avoids "${word}"`, !hasPhrase(text, word), "Present");
  const words = wordCount(text);
  const preset = item.preset || "enhance";
  const max = expect.maxWords ?? (preset === "concise" ? 45 : 400);
  check(`at most ${max} words`, words <= max, `${words} words`);
  const min = expect.minWords ?? (preset === "enhance" ? wordCount(item.prompt) + 3 : 1);
  check(`at least ${min} words`, words >= min, `${words} words`);
  const tone = expect.tone || tones[preset];
  if (tone?.length)
    check(
      `${preset} tone`,
      tone.some((word) => lower(text).includes(lower(word))),
      `None of ${tone.join(", ")}`,
    );
  return { id: item.id, ok: checks.every((entry) => entry.ok), checks };
}

/** Scores one LoRA match: every expected LoRA in, no forbidden one. */
export function scoreLoras(item, loras) {
  const names = new Set((loras || []).map((entry) => entry.name));
  const checks = [
    ...(item.expected || []).map((name) => ({ name: `suggests ${name}`, ok: names.has(name) })),
    ...(item.forbidden || []).map((name) => ({ name: `never ${name}`, ok: !names.has(name) })),
    ...(item.expected?.length ? [] : [{ name: "suggests nothing", ok: names.size === 0 }]),
  ];
  return { id: item.id, ok: checks.every((entry) => entry.ok), checks };
}

/** Scores one negative: unused where expected, wanted terms in, the prompt's subjects out. */
export function scoreNegative(item, result) {
  const expect = item.expect || {};
  const checks = [];
  if (expect.unused)
    checks.push({ name: "unused", ok: result?.unused === true && result?.negative === null });
  else {
    const text = String(result?.negative || "");
    checks.push({ name: "written", ok: Boolean(text.trim()) });
    for (const term of expect.include || [])
      checks.push({ name: `includes "${term}"`, ok: hasPhrase(text, term) });
    for (const term of expect.avoid || [])
      checks.push({ name: `avoids "${term}"`, ok: !hasPhrase(text, term) });
    checks.push({ name: "at most 40 words", ok: wordCount(text) <= 40 });
  }
  return { id: item.id, ok: checks.every((entry) => entry.ok), checks };
}

// Words that show a camera move or a sound cue; a motion prompt needs one of each (cases may narrow the camera).
const cameraWords = [
  "camera",
  "shot",
  "push",
  "pull",
  "dolly",
  "orbit",
  "track",
  "pan",
  "tilt",
  "crane",
  "static",
  "locked",
  "handheld",
  "close-up",
];
const soundWords = [
  "sound",
  "ambience",
  "hum",
  "creak",
  "rustle",
  "crackle",
  "clack",
  "clang",
  "scrape",
  "thump",
  "splash",
  "crash",
  "roar",
  "hiss",
  "slap",
  "says",
  "shout",
  "whisper",
  "growl",
  "thunder",
];
// A section label at the start of a line, such as H3's `overall_soundscape:`.
const sectionLabel = /^([a-z]+(?:_[a-z]+)*):/gm;

/** Scores one motion prompt: the guide's sections in order (or none), a camera, sound, no filler. */
export function scoreAnimate(item, output) {
  const text = String(output || "");
  const expect = item.expect || {};
  const checks = [];
  const check = (name, ok, detail = "") =>
    checks.push({ name, ok: Boolean(ok), ...(ok || !detail ? {} : { detail }) });
  check("written", text.trim(), "Empty");
  check(
    "no preamble",
    !/^(here(?:'s| is)|sure|certainly|motion prompt)\b/i.test(text.trim()),
    text.slice(0, 40),
  );
  for (const phrase of expect.keep || [])
    check(`keeps "${phrase}"`, hasPhrase(text, phrase), "Missing");
  const labels = [...text.matchAll(sectionLabel)].map((match) => match[1]);
  const sections = expect.sections || [];
  check(
    sections.length ? "every section in order" : "no section labels",
    labels.join() === sections.join() && (sections.length || !/^\s*\[Shot 1\]/.test(text)),
    labels.join(", ") || "none",
  );
  const camera = expect.camera || cameraWords;
  check(
    "a camera move",
    camera.some((word) => lower(text).includes(word)),
    `None of ${camera.join(", ")}`,
  );
  check(
    "sound",
    soundWords.some((word) => lower(text).includes(word)),
    "No sound cue",
  );
  if (expect.dialogue)
    check(
      "dialogue",
      quotedText(text).length || /<d>[^<]+<\/d>/.test(text),
      "No quoted or <d> line",
    );
  const filler = animateFiller.filter((word) => hasPhrase(text, word));
  check("no filler", !filler.length, filler.join(", "));
  for (const phrase of expect.avoid || [])
    check(`moves on from "${phrase}"`, !hasPhrase(text, phrase), "Repeated");
  const words = wordCount(text);
  const [min, max] = [expect.minWords ?? 80, expect.maxWords ?? 600];
  check(`${min} to ${max} words`, words >= min && words <= max, `${words} words`);
  return { id: item.id, ok: checks.every((entry) => entry.ok), checks };
}

const reply = (content) => Response.json({ choices: [{ message: { content } }] });

/**
 * Runs every case through the engine and scores it. Without `fetchImpl` the recorded replies answer
 * (CI); with one (the live gateway) `onReply(kind, id, content)` hears each raw reply for recording.
 */
export async function runEvals({
  evals = loadEvals(),
  environment,
  fetchImpl,
  onReply = () => {},
} = {}) {
  const recorded = { current: "" };
  const env = environment || {
    STUDIO_ASSISTANT_URL: "http://recorded.invalid",
    STUDIO_ASSISTANT_KEY: "recorded",
    STUDIO_ASSISTANT_CLOUD_MODEL: "recorded",
  };
  const live = typeof fetchImpl === "function";
  let current = { kind: "", id: "" };
  const transport = async (url, options) => {
    if (!live) return reply(recorded.current);
    const response = await fetchImpl(url, options);
    if (/chat\/completions$/.test(url) && response.ok) {
      const answer = await response
        .clone()
        .json()
        .catch(() => null);
      onReply(current.kind, current.id, String(answer?.choices?.[0]?.message?.content || ""));
    }
    return response;
  };
  const engine = createAssistant(env, {
    fetchImpl: transport,
    log: {},
    ...(live ? {} : { timeoutMs: 5_000 }),
  });
  const results = { rewrite: [], loras: [], negative: [], animate: [] };
  for (const item of evals.rewrite.cases) {
    current = { kind: "rewrite", id: item.id };
    recorded.current = item.recorded;
    const result = await engine.rewrite({
      profile: item.profile,
      guide: item.guide || null,
      prompt: item.prompt,
      preset: item.preset || "enhance",
      stack: item.stack || [],
    });
    results.rewrite.push({
      ...scoreRewrite(item, result.source === "assistant" ? result.prompt : ""),
      output: result.prompt,
    });
  }
  for (const item of evals.loras.cases) {
    current = { kind: "loras", id: item.id };
    recorded.current = item.recorded;
    const result = await engine.matchLoras({
      profile: item.profile,
      prompt: item.prompt,
      loras: evals.loras.catalogue,
      limit: item.limit || 4,
    });
    results.loras.push({
      ...scoreLoras(item, result.loras),
      output: result.loras.map((entry) => entry.name),
    });
  }
  for (const item of evals.negative.cases) {
    current = { kind: "negative", id: item.id };
    recorded.current = item.recorded || "";
    const result = await engine.negative({
      profile: item.profile,
      guide: item.guide || null,
      prompt: item.prompt,
      cfg: item.cfg,
    });
    results.negative.push({ ...scoreNegative(item, result), output: result.negative });
  }
  for (const item of evals.animate.cases) {
    current = { kind: "animate", id: item.id };
    recorded.current = item.recorded;
    const result = await writeAnimatePrompt({
      engine,
      profile: item.profile,
      guide: item.guide || null,
      writing: { kind: "animate", instruction: "", ...item.writing },
      seconds: item.seconds || 0,
    }).catch(() => ({ prompt: "" }));
    results.animate.push({ ...scoreAnimate(item, result.prompt), output: result.prompt });
  }
  const all = Object.values(results).flat();
  return { results, passed: all.filter((entry) => entry.ok).length, total: all.length };
}
