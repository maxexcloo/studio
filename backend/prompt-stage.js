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
import { storyContext } from "./domain/writing-standard.ts";
import { animateClip, animateIssue, animateRequest, writeAnimatePrompt } from "./prompt-animate.js";
import { writeSetPrompt } from "./prompt-set.js";
import { sheetRequest, writeSheetPrompt } from "./prompt-sheet.js";
import { resolveImageMode, runProfile } from "./workflow-modes.js";

/** The admitted writing request: only its kind's request fields, never a written result; or null. */
export function writingRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.kind === "animate") return animateRequest(value);
  if (value.kind === "set")
    return { kind: "set", ...(value.scope === "image" ? { scope: "image" } : {}) };
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
    return { status: 403, error: "Extended Themes needs Uncensored Models for this account." };
  return writing.kind === "animate" ? animateIssue(writing, { engine, allowed }) : null;
}

/**
 * The stage's writer. `account(ownerId)` is the owner's access (undefined in single-user mode, null
 * once gone), `profiles(account)` the generation profiles it may use, `guide(profile)` a profile's
 * prompting guide, `dream()` Dream, `frame(account, assetId)` a reference image as the text model
 * reads it, `caption(account, assetId)` what it shows in words and `setPrompts(job)` the selected
 * source and the prompts the job's result set holds so far.
 */
export function createPromptStage({
  engine,
  account,
  profiles,
  guide,
  dream,
  frame,
  caption = () => "",
  setPrompts,
}) {
  return async (job, stream) => {
    const { signal, onThinking, onDelta } = stream;
    const writing = job.input.writing;
    if (writing.kind === "dream") return dream().write(job, stream);
    const access = account(job.ownerId);
    if (access === null) throw new Error("This account no longer has access.");
    const issue = writingIssue(writingRequest(writing), { engine, account: access });
    if (issue) throw new Error(issue.error);
    const listed = (await profiles(access)).find((item) => item.id === job.input.profileId);
    if (!listed) throw new Error("The model is no longer available to this account.");
    const profile = runProfile(listed, job.input.profileBackend);
    const writer = job.dream
      ? dream().text(job.ownerId)
      : promptWriter(access, accountPreferences(job.ownerId || ""));
    // The story an MCP chat gave its result set, which its variations and clips keep to.
    const story = storyContext(job.input.resultSet?.context);
    if (writing.kind === "set")
      return writeSetPrompt({
        engine,
        profile,
        guide: guide(profile),
        title: job.input.resultSet?.title || "",
        scope: writing.scope,
        frame: () => frame(access, job.parentItemId),
        caption: () => caption(access, job.parentItemId),
        ...setPrompts(job),
        story,
        writer,
        signal,
        onThinking,
        onDelta,
      });
    const references = job.input.referenceAssets || [];
    if (writing.kind === "sheet") {
      const source = references[0]?.assetId;
      return writeSheetPrompt({
        engine,
        writing,
        writer,
        frame: () => frame(access, source),
        caption: () => caption(access, source),
        signal,
        onThinking,
        onDelta,
      });
    }
    const video = { ...profile, ...resolveImageMode(profile, job.input) };
    const startSlot = video.mediaInputs?.find((slot) => slot.role === "start");
    const start = (
      startSlot ? references.find((item) => item.slot === startSlot.id) : references[0]
    )?.assetId;
    return writeAnimatePrompt({
      engine,
      profile: video,
      guide: guide(video),
      writing,
      clip: animateClip(job.input, video),
      explicit: job.dream
        ? Boolean(job.dream.spicy) && dream().allowsUncensored(job.ownerId)
        : !access || mayUseFeature(access, "uncensoredModels"),
      story,
      writer,
      frame: () => frame(access, start),
      caption: () => caption(access, start),
      signal,
      onThinking,
      onDelta,
    });
  };
}
