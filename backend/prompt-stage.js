/**
 * The queue's writing stage (domain/queue.ts). Every prompt-assistant use that leads to a generation
 * writes its prompt as the queue item's first stage, from the request a surface sets as
 * `input.writing`:
 *
 *   animate   the viewer's Animate menu and MCP reuse's themes (prompt-animate.js)
 *   dream     Dream's ideas (domain/dream.ts)
 *   set       More Like This Set's new variations of an MCP result set (prompt-set.js)
 *   sheet     Make Sheet's character design sheet (prompt-sheet.js)
 *
 * Admission keeps only the request (writingRequest) and refuses one the account can't have written
 * (writingIssue). The stage resolves the job's profile and guide and streams the thinking and the
 * prompt into the item; a failure throws with the reason, which fails the item.
 */
import { mayUseFeature, promptWriter } from "./account-policy.js";
import { accountPreferences } from "./account-preferences.js";
import { promptAssistantOff } from "./assistant-routes.js";
import { dreamRequest } from "./domain/dream.ts";
import { animateClip, animateIssue, animateRequest, writeAnimatePrompt } from "./prompt-animate.js";
import { writeSetPrompt } from "./prompt-set.js";
import { sheetRequest, writeSheetPrompt } from "./prompt-sheet.js";

/** The admitted writing request: only its kind's request fields, never a written result; or null. */
export function writingRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.kind === "animate") return animateRequest(value);
  if (value.kind === "set") return { kind: "set" };
  if (value.kind === "sheet") return sheetRequest(value);
  if (value.kind === "dream") return dreamRequest(value);
  return null;
}

/** Why the account can't have this prompt written, as { status, error }, or null. */
export function writingIssue(writing, { engine, account }) {
  const allowed = (feature) => !account || mayUseFeature(account, feature);
  if (!writing) return { status: 400, error: "Choose a known way to write the prompt." };
  // Animate's themes, a set's variations and a sheet are written for the person; Dream's writing
  // follows the Dream feature.
  if (writing.kind !== "dream" && !allowed("promptAssistant"))
    return { status: 403, error: promptAssistantOff };
  if (!engine) return { status: 503, error: "The prompt assistant is not configured." };
  if (writing.kind === "dream" && writing.spicy && !allowed("uncensoredModels"))
    return { status: 403, error: "Spicy needs Uncensored Models for this account." };
  return writing.kind === "animate" ? animateIssue(writing, { engine, allowed }) : null;
}

/**
 * The stage's writer. `account(ownerId)` is the owner's access (undefined in single-user mode, null
 * once gone), `profiles(account)` the generation profiles it may use, `guide(profile)` a profile's
 * prompting guide, `dream()` Dream, `frame(account, assetId)` a reference image as the text model
 * reads it, `caption(account, assetId)` what it shows in words and `setPrompts(job)` the prompts
 * the job's result set holds so far.
 */
export function createPromptStage({
  engine,
  account,
  profiles,
  guide,
  dream,
  frame,
  caption = () => "",
  setPrompts = () => [],
}) {
  return async (job, stream) => {
    const { signal, onThinking, onDelta } = stream;
    const writing = job.input.writing;
    if (writing.kind === "dream") return dream().write(job, stream);
    const access = account(job.ownerId);
    if (access === null) throw new Error("This account no longer has access.");
    const issue = writingIssue(writingRequest(writing), { engine, account: access });
    if (issue) throw new Error(issue.error);
    const profile = (await profiles(access)).find((item) => item.id === job.input.profileId);
    if (!profile) throw new Error("The model is no longer available to this account.");
    const writer = promptWriter(access, accountPreferences(job.ownerId || ""));
    if (writing.kind === "set")
      return writeSetPrompt({
        engine,
        profile,
        guide: guide(profile),
        title: job.input.resultSet?.title || "",
        prompts: setPrompts(job),
        writer,
        signal,
        onThinking,
        onDelta,
      });
    // The job's first reference is the frame it animates from, or the character a sheet redraws.
    const start = job.input.referenceAssets?.[0]?.assetId;
    if (writing.kind === "sheet")
      return writeSheetPrompt({
        engine,
        writing,
        writer,
        frame: () => frame(access, start),
        caption: () => caption(access, start),
        signal,
        onThinking,
        onDelta,
      });
    return writeAnimatePrompt({
      engine,
      profile,
      guide: guide(profile),
      writing,
      clip: animateClip(job.input, profile),
      explicit: !access || mayUseFeature(access, "uncensoredModels"),
      writer,
      frame: () => frame(access, start),
      caption: () => caption(access, start),
      signal,
      onThinking,
      onDelta,
    });
  };
}
