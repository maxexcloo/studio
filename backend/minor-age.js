// Studio makes no image or video of anyone under 18. The text model judges each prompt against the
// `minor-age-check` instruction (assistant.js judgeMinorAge): one that states an age under 18 or
// names a minor outright, or that frames someone as a minor beside sexual, nude, revealing or
// suggestive wording, whatever adult age it also states, is refused. Every path that writes or
// queues a prompt uses this one check (admission, the queue, the assistant, characters, imports)
// before it reaches a model. It fails closed: text the check couldn't judge is refused too.

const cacheLimit = 2000;
let engine = null;
/** Verdicts by text, as promises so concurrent checks of one text share a call. */
const verdicts = new Map();

/** The assistant engine (assistant.js) that judges text; until one is set, all text is refused. */
export function useMinorAgeCheck(assistant) {
  engine = assistant;
  verdicts.clear();
}

async function judge(text) {
  const verdict = await engine.judgeMinorAge(text);
  if (typeof verdict?.refuse !== "boolean") throw new Error("unusable verdict");
  const words = (value) => (typeof value === "string" ? value.trim().slice(0, 120) : "");
  return { refuse: verdict.refuse, minor: words(verdict.minor), sexual: words(verdict.sexual) };
}

function verdictOf(text) {
  const cached = verdicts.get(text);
  if (cached) return cached;
  const pending = judge(text);
  verdicts.set(text, pending);
  if (verdicts.size > cacheLimit) verdicts.delete(verdicts.keys().next().value);
  // Only answers are kept; a failed check runs again next time.
  pending.catch(() => verdicts.delete(text));
  return pending;
}

/**
 * The refusal for text that codes someone as under 18, or '' when it codes none. Where the check
 * can't run, the refusal asks to try again.
 */
export async function minorAgeRefusal(text) {
  const value = String(text || "").trim();
  if (!value) return "";
  let verdict;
  try {
    if (!engine) throw new Error("no text model");
    verdict = await verdictOf(value);
  } catch {
    return "Studio couldn't check this prompt for anyone under 18 just now, so it didn't use it. Try again in a moment.";
  }
  if (!verdict.refuse) return "";
  const words = verdict.minor || "its age wording";
  return verdict.sexual
    ? `Studio makes no sexual or suggestive images or videos of anyone who reads as under 18, and this prompt pairs "${words}" with "${verdict.sexual}", whatever age it states. Drop that teen, school or child framing; a woman or man needs no added "adult" or age.`
    : `Studio makes no images or videos of anyone under 18, and this prompt says "${words}". Drop it; a woman or man needs no added "adult" or age.`;
}
