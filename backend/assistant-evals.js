// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The prompt assistant's eval set (backend/fixtures/assistant-evals/) and its deterministic scorer.
 * CI replays the recorded replies through the engine (assistant-evals.test.js); `mise run
 * eval:assistant` replays the same cases against the live gateway on demand (backend/commands/assistant-eval.mjs).
 *
 *   rewrite.json   prompts per preset: subjects and quoted text kept, no setting words, preset tone
 *   loras.json     prompts against a frozen catalogue snapshot: expected and forbidden LoRAs
 *   negative.json  negatives: unused where the guide says so, wanted terms, no prompt subjects
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAssistant } from "./assistant.js";
import { settingWords } from "./assistant-presets.js";

export const evalsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "assistant-evals",
);
export const loadEvals = (dir = evalsDir) =>
  Object.fromEntries(
    ["rewrite", "loras", "negative"].map((name) => [
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
  photographic: ["photo", "photograph", "lens", "mm", "camera", "shot", "aperture", "exposure"],
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
  candid: ["candid", "snapshot", "phone", "unposed", "everyday", "mid-", "natural light", "casual"],
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
    STUDIO_PROMPT_WRITER_URL: "http://recorded.invalid",
    STUDIO_PROMPT_WRITER_KEY: "recorded",
    STUDIO_PROMPT_WRITER_MODEL: "recorded",
    STUDIO_ASSISTANT_SPICY_MODEL: "recorded-spicy",
  };
  const live = typeof fetchImpl === "function";
  let current = { kind: "", id: "" };
  const transport = async (url, options) => {
    if (!live)
      return url.endsWith("/model/info") ? Response.json({ data: [] }) : reply(recorded.current);
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
    timeoutMs: live ? 60_000 : 5_000,
  });
  const results = { rewrite: [], loras: [], negative: [] };
  const skipped = [];
  for (const item of evals.rewrite.cases) {
    // Live, Spicy runs only with a Spicy model chosen.
    if (item.preset === "spicy" && !engine.settings().spicyModel) {
      skipped.push(item.id);
      continue;
    }
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
  const all = [...results.rewrite, ...results.loras, ...results.negative];
  return { results, skipped, passed: all.filter((entry) => entry.ok).length, total: all.length };
}
