// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The queue's writing stage (domain/queue.ts). Every prompt-assistant use that leads to a generation
 * writes its prompt as the queue item's first stage, from the request a surface sets as
 * `input.writing`:
 *
 *   animate   the viewer's Animate menu (prompt-animate.js)
 *   request   MCP Generate and Reuse: the user's request and its changes (prompt-writer.js)
 *   dream     Dream's ideas (domain/dream.ts)
 *
 * Admission keeps only the request (writingRequest) and refuses one the account can't have written
 * (writingIssue). The stage resolves the job's profile and guide and streams the thinking and the
 * prompt into the item; a failure throws with the reason, which fails the item.
 */
import { mayUseFeature } from "./account-policy.js";
import { maxPromptCharacters } from "./assistant.js";
import { withLoraTags } from "./lora-prompts.js";
import { animateIssue, animateRequest, writeAnimatePrompt } from "./prompt-animate.js";

const text = (value, limit = maxPromptCharacters) =>
  String(typeof value === "string" ? value : "")
    .trim()
    .slice(0, limit);
const whole = (value, max) => Math.max(0, Math.min(max, Math.round(Number(value) || 0)));

/** The admitted writing request: only its kind's request fields, never a written result; or null. */
export function writingRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.kind === "animate") return animateRequest(value);
  if (value.kind === "request")
    return {
      kind: "request",
      request: text(value.request),
      changes: (Array.isArray(value.changes) ? value.changes : [])
        .map((item) => text(item))
        .filter(Boolean)
        .slice(-8),
      role: text(value.role, 40),
      references: whole(value.references, 16),
      index: whole(value.index, 63),
      of: Math.max(1, whole(value.of, 64)),
      ...(value.loraTags === true ? { loraTags: true } : {}),
    };
  if (value.kind === "dream")
    return {
      kind: "dream",
      ...(value.spicy === true ? { spicy: true } : {}),
      ...(text(value.source, 1000) ? { source: text(value.source, 1000) } : {}),
      loras: (Array.isArray(value.loras) ? value.loras : [])
        .map((name) => text(name, 300))
        .filter(Boolean)
        .slice(0, 8),
    };
  return null;
}

/** Why the account can't have this prompt written, as { status, error }, or null. */
export function writingIssue(writing, { engine, account }) {
  const allowed = (feature) => !account || mayUseFeature(account, feature);
  if (!writing) return { status: 400, error: "Choose a known way to write the prompt." };
  if (!engine) return { status: 503, error: "The prompt assistant is not configured." };
  if (!allowed("promptAssistant"))
    return { status: 403, error: "The prompt assistant is off for this account." };
  if (writing.kind === "request" && !writing.request)
    return { status: 400, error: "Describe what to generate." };
  return writing.kind === "animate" ? animateIssue(writing, { engine, allowed }) : null;
}

/**
 * The stage's writer. `account(ownerId)` is the owner's access (undefined in single-user mode, null
 * once gone), `profiles(account)` the generation profiles it may use and `guide(profile)` a profile's
 * prompting guide; `writer` is MCP's prompt writer, `dream()` Dream and `taste(ownerId)` the taste
 * profile summary.
 */
export function createPromptStage({
  engine,
  writer,
  account,
  profiles,
  guide,
  loraInfos,
  dream,
  taste,
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
    if (writing.kind === "animate")
      return writeAnimatePrompt({
        engine,
        profile,
        guide: guide(profile),
        writing,
        signal,
        onThinking,
        onDelta,
      });
    if (!writer) throw new Error("The prompt writer is not configured.");
    // References pick the profile's reference mode and its guide.
    const guided =
      writing.references && profile.imageModes?.reference
        ? { ...profile, ...profile.imageModes.reference }
        : profile;
    const written = await writer.write({
      profile,
      guide: guide(guided),
      request: writing.request,
      changes: writing.changes,
      index: writing.index,
      of: writing.of,
      references: writing.references,
      role: writing.role,
      taste: taste(job.ownerId),
      signal,
      onThinking,
      onDelta,
    });
    const loras = (Array.isArray(job.input.loras) ? job.input.loras : []).filter(
      (item) => item?.name && item.enabled !== false,
    );
    // Prompts Studio writes get tag-trained LoRAs' line of tags; generation adds the trigger words.
    const prompt =
      writing.loraTags && loras.length
        ? withLoraTags(
            written.prompts[0],
            loras,
            await loraInfos(loras.map((item) => item.name)),
            writing.request,
          )
        : written.prompts[0];
    return { prompt, thinking: written.thinking, model: written.model };
  };
}
