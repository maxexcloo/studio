// MCP's tools that choose a model and queue work: models, generate and reuse.
import crypto from "node:crypto";

import { z } from "zod";

import {
  cardImageNote,
  cardImageSlots,
  characterImages,
  characterProfiles,
  characterTraits,
  composePrompt,
  identitySlot,
  keepsCharacterFaces,
  keepsIdentity,
  maxCardDescription,
  maxCardName,
  maxCharacterAge,
  maxCharacterTrait,
  maxContextNotes,
  maxNewCharacters,
  minCharacterAge,
  startImageSlot,
  withCharacter,
} from "../../shared/characters.ts";
import { compareVariants } from "../../shared/compare.ts";
import { isCloudProfile, loraStrengthSweep, profileBackendLabels } from "../../shared/profiles.ts";
import { availableResolutions, profileStartingSize, resolutions } from "../../shared/resolution.ts";
import { promptWords } from "../../shared/titles.ts";
import { upscaleQualities } from "../../shared/upscale.ts";
import { maxResultCaption } from "../gallery/records.js";
import { profileAspectSize } from "../generation-defaults.js";
import { recommendedNegative } from "../lora/prompts.js";
import { minorAgeRefusal } from "../minor-age.js";
import { savedDocument, writeRuntimeDocument } from "../persistence/runtime.ts";
import { promptStyleStore } from "../prompt-styles.js";
import {
  maxJobsPerCall,
  maxSplitJobs,
  mcpControls,
  mcpGenerationCount,
  prepareLoras,
} from "./controls.js";
import { findCard } from "./manage.js";
import { aboutTime, assertJobCount, mcpJson, readyIn, scopeMarkdown, setItems } from "./media.js";
import { namedInTier, referenceCount, registerModelTool, tier } from "./models.js";
import {
  accountTaste,
  assertAvoided,
  assertProjectReuse,
  assertTasteExclusions,
  briefLine,
  converging,
  keptChoices,
  projectArgs,
  projectTargets,
  rulesLine,
} from "./project.js";
import {
  exactPromptInstructions,
  fullBodyPerson,
  promptListProblem,
  repeatedSetProblem,
  requestedCount,
  turnCountProblem,
} from "./prompt-checks.js";
import { compactGuide } from "./prompting.js";
import { output, shortPrompt } from "./results.js";
import {
  asksForCloud,
  chooseProfile,
  localUnlessAsked,
  profileFromRequest,
  profilesForTier,
  tierOf,
  waitingNote,
  workerState,
} from "./tiers.js";

const letter = (index) => String.fromCharCode(65 + index);
// A preview's prompts wait this long for the user's go-ahead.
const previewMs = 30 * 60 * 1000;
/** JSON with sorted keys and undefined left out, so equal arguments give equal text. */
const stableJson = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .filter((name) => item[name] !== undefined)
            .map((name) => [name, item[name]]),
        )
      : item,
  );
// The animation themes reuse takes (Library › Prompt Styles' enabled Animate records), checked at
// call time like tier.
const themeIds = () =>
  promptStyleStore()
    .usable("animate")
    .map((style) => style.id);
const theme = z
  .string()
  .trim()
  .toLowerCase()
  .superRefine((value, context) => {
    if (!themeIds().includes(value))
      context.addIssue({ code: "custom", message: `Use one of ${themeIds().join(", ")}` });
  })
  .describe(`One of ${themeIds().join(", ")}.`);
/**
 * A run's size: the shape the chat named as the profile's preset, else the account's Settings
 * aspect as the composer starts (profileStartingSize), else the profile's own canvas. The account's
 * resolution applies where the chat named none and the profile draws it.
 */
function runSize(profile, aspect, resolution) {
  const { width, height } =
    aspect || !profile.imagePreference?.imageAspect
      ? profileAspectSize(profile, aspect ? { aspect } : {})
      : profileStartingSize(profile);
  const preferred = profile.imagePreference?.imageResolution;
  const native = profile.options?.resolutions;
  const takes =
    preferred &&
    !resolution &&
    (native?.length
      ? native.some((value) => value.toUpperCase() === preferred)
      : availableResolutions(profile, { kind: profile.kind, width, height }).includes(preferred));
  return { width, height, ...(takes ? { resolution: preferred } : {}) };
}
const jobCount = z.number().int().min(1).max(maxJobsPerCall);
/**
 * What each chat turn has queued, `{ images, sets }`, so the turn stops at the number its request
 * asked for and its later calls bring new prompts.
 */
const turnRuns = new Map();
const outputCount = (jobs) => jobs.reduce((total, job) => total + (job.images || 1), 0);
const setTitle = z.string().trim().min(1).max(80);
// Kept short in the schema: gallery/records.js storedResultSet trims what it stores.
const cardContext = z.object({ name: z.string(), description: z.string().optional() });
// Stored on the results, where Studio offers to save the character, outfit and scene as cards.
const chatContext = z
  .object({
    character: cardContext.optional(),
    outfit: cardContext.optional(),
    scene: cardContext.optional(),
    series: z.string().optional().describe("The user's theme, shared across sets."),
    notes: z.string().max(maxContextNotes).optional(),
  })
  .describe("Who and what it shows; notes: direction and background, kept for Dream.");
const promptList = z.array(z.string().trim().min(1)).min(1).max(maxSplitJobs);
/** A JSON array sent as one string, or a single prompt. */
const promptListText = z.string().transform((text) => {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [text];
  } catch {
    return [text];
  }
});
// LibreChat summarises long chats, dropping a guide sent early, so generate sends it again after this many
// generates or minutes on the same model; a compact guide costs about as much context as one reply.
const guideResendGenerates = 8;
const guideResendMs = 30 * 60_000;
const maxGuideKeys = 4096;

/**
 * Which guides each conversation has been sent, in the runtime store so a rollout or another
 * replica doesn't resend them. `due` counts a use and reports whether the guide is due; it reads
 * and writes synchronously, so concurrent calls attach a guide once.
 */
export function createGuideLog({ dataDir }) {
  const all = () => savedDocument(dataDir, "mcp-guides") ?? {};
  const save = (saved) => {
    const keys = Object.keys(saved);
    for (const old of keys.slice(0, Math.max(0, keys.length - maxGuideKeys))) delete saved[old];
    writeRuntimeDocument(dataDir, "mcp-guides", saved);
  };
  return {
    due(key) {
      const saved = all();
      const sent = saved[key];
      if (sent && sent.uses < guideResendGenerates && Date.now() - sent.at < guideResendMs) {
        sent.uses++;
        save(saved);
        return false;
      }
      delete saved[key];
      saved[key] = { at: Date.now(), uses: 1 };
      save(saved);
      return true;
    },
    forget(key) {
      const saved = all();
      delete saved[key];
      save(saved);
    },
  };
}
/** Registers models, generate and reuse; returns namedInTier for the assistant tools' profile lookup. */
export function registerGenerateTools({
  tool,
  server,
  media,
  actor,
  resolveOutput,
  referenceAsset,
  publicUrl,
  generateDedupeMs,
  reviewedGuides,
  recentGenerates,
  previews,
  chatAssistant,
  chatChoices,
}) {
  const { owner, refs, conversation, turn } = actor;
  const turnKey = JSON.stringify([owner, conversation, turn]);
  // A guide goes to each conversation (each MCP session without a conversation header, else the account).
  const guideKey = (profileId) => JSON.stringify([refs, profileId]);
  const review = (profileId) => reviewedGuides.due(guideKey(profileId));
  /** What to say about a queued profile whose worker isn't running; Cloud only as a suggestion the account can take. */
  const waiting = async (profile) =>
    workerState[profile.availability]
      ? waitingNote(profile, (await media.profiles(profile.kind, owner)).some(isCloudProfile))
      : "";
  /** A submission's reply: finished markdown when every job ends within the wait, otherwise result links for the queued jobs, which end the agent's turn. */
  // What a submission left out (media.queue), said before anything else so the chat can tell the user.
  const ignoredNote = (submission) => (submission.ignored ? `${submission.ignored} ` : "");
  const respond = async (
    submission,
    profile,
    signal,
    guide = "",
    promptSource = "exact",
    note = "",
  ) => {
    const label = profile.label || profile.id;
    // Iterations that rebuild a whole generate call drift from the result; reuse keeps its settings.
    const followUp = `To change or animate one later, call reuse with its ref (such as "${submission.jobs[0]?.ref || "result 1"}") and its full prompt revised (status shows it).`;
    const {
      ends: [endsAt],
      ahead,
    } = await media.finishTimes(owner, [submission], { signal });
    const left = endsAt === null ? 0 : Math.max(0, endsAt - Date.now());
    const accepted = outputCount(submission.jobs);
    const resultCount = `${accepted} ${profile.kind || "image"}${accepted === 1 ? "" : "s"}`;
    const structured = {
      status: submission.status,
      accepted,
      profile: {
        id: profile.id,
        label,
        tier: tierOf(profile),
        ...(isCloudProfile(profile) ? { remote: true } : {}),
      },
      prompt_source: promptSource,
      ...(left ? { eta_seconds: Math.round(left / 1000) } : {}),
      ...(ahead === undefined ? {} : { jobs_ahead: ahead }),
      jobs: submission.jobs.map(({ job_id, ref, link, status, images }) => ({
        job_id,
        ref,
        link,
        ...(status ? { status } : {}),
        ...(images ? { images } : {}),
      })),
    };
    // The profile's guide follows its first use in a conversation, so the agent applies it to later prompts.
    const extra = guide
      ? [
          {
            type: "text",
            text: `Prompting guide for ${label} (its essentials; models with full_guide has pitfalls and examples); apply it to later prompts: ${guide}`,
          },
        ]
      : [];
    const links = media.scopeLinks(
      owner,
      profile.kind,
      submission.jobs.map(({ job_id }) => job_id),
      conversation,
    );
    const pending = [
      ...submission.jobs.map(
        ({ ref, link, images }) =>
          `[${ref[0].toUpperCase()}${ref.slice(1)}](${link})${images ? ` (${images} images)` : ""}`,
      ),
      scopeMarkdown(links, profile.kind),
    ].join(" · ");
    const message =
      submission.status === "queued"
        ? `Queued on ${label}${readyIn(left, ahead)}. ${ignoredNote(submission)}${note}${await waiting(profile)}Studio accepted ${resultCount} in this batch. Share the links and end the turn. Call result only if asked. Never poll or resubmit. ${followUp}`
        : `${submission.error} ${ignoredNote(submission)}${note}Studio accepted ${resultCount} in this batch. Share the links; never resubmit.`;
    return {
      content: [{ type: "text", text: `${message}\n\n${pending}` }, ...extra],
      structuredContent: {
        ...structured,
        links,
        ...(submission.error ? { error: submission.error } : {}),
      },
    };
  };
  /**
   * `compareVariants` single-image sets become one labelled side-by-side page (/compare/:id), or "" when the run
   * doesn't fit one (videos, several images per model, a refused set) or the comparison can't be saved.
   * A one-thing comparison (`axis`) letters its options, which the chat's "B" then picks (variants).
   */
  const comparisonOf = async (sets, { axis, project } = {}) => {
    const jobs = sets.map(({ queued }) => queued.jobs || []);
    if (
      sets.length < compareVariants.min ||
      sets.length > compareVariants.max ||
      sets.some(({ profile, queued }) => profile.kind === "video" || queued.error) ||
      jobs.some((list) => list.length !== 1)
    )
      return "";
    try {
      const labels = sets.map(({ profile, label }, index) =>
        `${axis ? `${letter(index)} · ` : ""}${label || profile.label || profile.id}`.slice(0, 80),
      );
      const { id = "" } = await media.request(
        "POST",
        "/api/comparisons",
        {
          jobIds: jobs.map(([job]) => job.job_id),
          labels,
          ...(axis ? { axis } : {}),
          ...(axis && project ? { projectId: project.id } : {}),
        },
        owner,
      );
      if (id && axis)
        media.offer(
          owner,
          refs,
          id,
          jobs.map(([job]) => job.job_id),
        );
      return id && `${publicUrl}/compare/${id}`;
    } catch {
      return "";
    }
  };
  /** Several models' sets as one reply: a line of result links per model with its expected wait, without waiting for any. */
  const respondSets = async (sets, note = "", signal, compare = "", axis = "") => {
    const link = ({ ref, link: url }) => `[${ref[0].toUpperCase()}${ref.slice(1)}](${url})`;
    const now = Date.now();
    const left = (
      await media.finishTimes(
        owner,
        sets.map(({ queued }) => queued),
        { signal },
      )
    ).ends.map((endsAt) => (endsAt === null ? 0 : Math.max(0, endsAt - now)));
    const lines = sets.map(
      ({ profile, label, queued }, index) =>
        `${axis ? `${letter(index)} · ` : ""}${label || profile.label || profile.id}: ${queued.error || queued.jobs.map(link).join(" · ")}${left[index] ? ` (${aboutTime(left[index])})` : ""}${queued.ignored ? ` ${queued.ignored}` : ""}`,
    );
    const kind = sets[0].profile.kind;
    const links = media.scopeLinks(
      owner,
      kind,
      sets.flatMap(({ queued }) => queued.jobs.map(({ job_id }) => job_id)),
      conversation,
    );
    const first = sets.find(({ queued }) => queued.jobs?.length)?.queued.jobs[0].ref || "result 1";
    const waits = [...new Set(await Promise.all(sets.map(({ profile }) => waiting(profile))))].join(
      "",
    );
    return {
      content: [
        {
          type: "text",
          text: `${axis ? `Queued options A–${letter(sets.length - 1)} varying ${axis} at one seed; the user picks a letter (variants pick).` : `Queued ${sets.length} sets, one per model.`} ${note}${waits}Share the links below, not images (none exist yet), and end your turn; do not call result now or in the background. Never poll or resubmit. To change or animate one later, call reuse with its ref (such as "${first}") and its full prompt revised (status shows it).${compare ? " Share the comparison link first: it shows them side by side with the same seed." : ""}\n\n${compare ? `[Compare Side by Side](${compare})\n` : ""}${lines.join("\n")}\n${scopeMarkdown(links, kind)}`,
        },
      ],
      structuredContent: {
        status: "queued",
        ...(compare ? { compare } : {}),
        links,
        sets: sets.map(({ profile, label, queued }, index) => ({
          profile: { id: profile.id, label: profile.label || profile.id },
          ...(label ? { label } : {}),
          ...(left[index] ? { eta_seconds: Math.round(left[index] / 1000) } : {}),
          jobs: (queued.jobs || []).map(({ job_id, ref, link: url }) => ({
            job_id,
            ref,
            link: url,
          })),
          ...(queued.error ? { error: queued.error } : {}),
        })),
      },
    };
  };
  /** Studio's usual pick; with several to choose from, the note says which, and where it gave way to the other side. */
  const picked = ({ pool, profile, note }) => ({
    profile,
    note: `${pool.length < 2 ? "" : `Chose ${profile.label || profile.id}, the default. `}${note || ""}`,
  });
  /**
   * Queues a submission with the request behind it. The profile's guide goes to a conversation that has
   * not had it, marked before any wait, so the chat writes its later prompts itself.
   */
  const submit = async (profile, args, record = {}, { guide = true, validate } = {}) => {
    const fresh = guide && review(profile.id);
    // Transport chunks share one set; each prompt keeps its own execution batch.
    const count = args.count ?? mcpGenerationCount;
    const size = Math.max(1, Math.floor(maxJobsPerCall / count));
    const prompts = args.prompts || [""];
    const queueSet = crypto.randomUUID();
    let queued;
    try {
      for (let at = 0; at < prompts.length; at += size) {
        const part = await media
          .queue(
            owner,
            prompts.length > size
              ? {
                  ...args,
                  prompts: prompts.slice(at, at + size),
                  ...(args.prompt_references
                    ? { prompt_references: args.prompt_references.slice(at, at + size) }
                    : {}),
                  ...(args.titles ? { titles: args.titles.slice(at, at + size) } : {}),
                  ...(args.captions ? { captions: args.captions.slice(at, at + size) } : {}),
                  ...(args.result_set ? { result_set: { ...args.result_set, first: at } } : {}),
                  ...(Number.isInteger(args.seed) && !args.same_seed
                    ? { seed: args.seed + at * count }
                    : {}),
                }
              : args,
            refs,
            { ...record, ...(conversation ? { conversation, turn } : {}) },
            queueSet,
            validate,
          )
          .catch((error) => {
            if (!queued) throw error;
            return {
              status: "partially_queued",
              jobs: [],
              error: `Further submission failed; retain returned jobs before retrying. ${error.message}`,
            };
          });
        part.jobs = part.jobs.map((job) => ({ ...job, prompt_index: at + job.prompt_index }));
        queued = queued
          ? {
              ...queued,
              ...(part.error ? { status: part.status, error: part.error } : {}),
              jobs: [...queued.jobs, ...part.jobs],
            }
          : part;
        if (queued.error) break;
      }
      if (prompts.length > size && !queued.error)
        queued.ignored = `${queued.ignored ? `${queued.ignored} ` : ""}Queued ${outputCount(queued.jobs)} images in batches of up to ${size * count}.`;
      return {
        queued,
        guide: fresh ? compactGuide(profile.prompting, Infinity, { essentials: true }) : "",
      };
    } catch (error) {
      // A refused submission delivered no guide, so the next attempt carries it.
      if (fresh) reviewedGuides.forget(guideKey(profile.id));
      throw error;
    }
  };
  registerModelTool({ tool, server, media, owner, review });
  tool(
    server,
    "generate",
    "generate",
    `Queue images or videos, at most ${maxSplitJobs} images per call. Models: profile_ids, or each_profile with kind and tier ("each turbo model"). preview queues nothing. Leave model, count, tier, size and LoRAs out unless asked (Studio uses the default model and its size). Pass other controls only as models lists them. upscale_quality only when the user asks to upscale or enlarge (it adds face detail for full-body people). Cloud profiles only if asked. Never make anyone sexual or nude under 18 or a teen, without adding "adult" or an age to say so.`,
    z.strictObject({
      request: z
        .string()
        .trim()
        .min(1)
        .max(4000)
        .optional()
        .describe("The user's words, with anything they refer back to."),
      // Models sometimes send the list as one string; clients reject what the published schema doesn't allow.
      prompts: z
        .union([promptList, promptListText.pipe(promptList)])
        .optional()
        .describe(
          "One finished prompt per distinct creative result. Continue with new directions when batching.",
        ),
      base: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Template; prompts are deltas put at its {} or after it."),
      axis: z
        .string()
        .trim()
        .min(1)
        .max(40)
        .optional()
        .describe(
          "Vary only this at one seed, one image each: values are prompts, profile_ids or strengths.",
        ),
      strengths: z
        .union([
          z.literal("sweep"),
          z.array(z.number().finite()).min(compareVariants.min).max(compareVariants.max),
        ])
        .optional()
        .describe('Test first LoRA. "sweep" uses Library defaults. 0 omits it.'),
      title: setTitle.optional().describe("2-5 words, Title Case."),
      titles: z
        .array(setTitle)
        .max(maxSplitJobs)
        .optional()
        .describe("One per prompt; Title Case."),
      captions: z
        .array(z.string().trim().max(maxResultCaption))
        .max(maxSplitJobs)
        .optional()
        .describe("One per prompt or LoRA strength."),
      context: chatContext.optional(),
      preview: z.boolean().optional(),
      count: jobCount
        .optional()
        .describe(
          `Repeats each prompt with new seeds (default ${mcpGenerationCount}, or the account's default for one prompt). For distinct results provide separate prompts.`,
        ),
      kind: z.enum(["image", "video"]).optional(),
      tier: tier.optional(),
      profile_id: z
        .string()
        .min(1)
        .optional()
        .describe("A model id, label or words from them; models lists what is ready."),
      profile_ids: z.array(z.string().min(1)).min(1).max(maxJobsPerCall).optional(),
      each_profile: z.boolean().optional(),
      loras: z
        .array(z.object({ name: z.string().min(1), strength: z.number().finite().optional() }))
        .max(8)
        .optional()
        .describe(
          "Only LoRAs the user asks for; strength only if they give one, so a set varies it.",
        ),
      reference_asset_ids: z
        .array(z.string().min(1))
        .max(16)
        .optional()
        .describe("Ids from search uploads or reuse reference, or a result's #number or letter."),
      reference_role: z.enum(["edit", "reference"]).optional(),
      // In reference_asset_ids order, where models lists the profile's reference_strengths.
      reference_strengths: z.array(z.number().finite().nullable()).max(16).optional(),
      // A character's name or id (models lists them).
      character: z.string().min(1).optional(),
      // Make Sheet: the character's design sheet, whose views generate then sends (character-sheets.js).
      character_sheet: z.boolean().optional(),
      // The user insists on a model that can't hold the character's face (the refusal says so).
      any_model: z.boolean().optional(),
      // Shots Studio writes itself (shared/characters.ts composePrompt); outfit and scene may name a card.
      shots: z
        .array(
          z.object({
            outfit: z.string().optional(),
            scene: z.string().optional(),
            action: z.string().optional(),
            camera: z.string().optional(),
          }),
        )
        .min(1)
        .max(maxJobsPerCall)
        .optional(),
      aspect: z
        .string()
        .optional()
        .describe("Only if the user asks: their word (portrait, landscape, square) or ratio."),
      resolution: z.enum(resolutions).optional().describe("Only if the user asks for a size."),
      steps: z.number().int().positive().max(10000).optional(),
      seed: z
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER - 4)
        .optional(),
      negative_prompt: z.string().optional(),
      cfg: z.number().finite().optional(),
      denoise: z.number().finite().optional(),
      rebalance: z.string().optional(),
      sampler: z.string().optional(),
      scheduler: z.string().optional(),
      upscale_quality: z.enum(upscaleQualities).optional(),
      face_detail: z.boolean().optional(),
    }),
    (input, signal) => {
      // Identical calls share pending work and its reply for two minutes after it settles.
      // A transport retry cannot queue another set; later or different requests queue anew.
      const now = Date.now();
      for (const [key, entry] of recentGenerates)
        if (entry.at !== null && now - entry.at > generateDedupeMs) recentGenerates.delete(key);
      const key = `${refs || owner}\n${stableJson(input)}`;
      const earlier = generateDedupeMs > 0 ? recentGenerates.get(key) : null;
      if (earlier) return earlier.reply;
      const accepted = { entries: [], set: 0 };
      const reply = generateOnce(input, signal, accepted).catch((error) => {
        if (!accepted.entries.length) throw error;
        // Delivery can fail after admission (an aborted ETA probe, or a later model's refusal).
        // Keep the accepted jobs as the deduplicated reply so a retry cannot queue them again.
        const number = accepted.set || recordSet(accepted.entries);
        return interrupted(accepted.entries, number, error);
      });
      const entry = { at: null, reply };
      recentGenerates.set(key, entry);
      reply.then(
        () => {
          entry.at = Date.now();
          const images = outputCount(accepted.entries.flatMap(({ queued }) => queued.jobs));
          if (turn && images) {
            const run = turnRuns.get(turnKey) || { images: 0, sets: [] };
            run.images += images;
            run.sets.push({
              number: accepted.set,
              prompts: accepted.entries.flatMap(({ plan }) => plan.prompts || []),
            });
            turnRuns.delete(turnKey);
            if (turnRuns.size >= 1000) turnRuns.delete(turnRuns.keys().next().value);
            turnRuns.set(turnKey, run);
          }
          // The chat's context, kept for Dream (Dream › Taste › Chat Notes) with the results it came with.
          const text = [input.context?.series, input.context?.notes].filter(Boolean).join(": ");
          const results = accepted.entries.flatMap(({ queued }) =>
            (queued.jobs || []).map((job) => job.job_id),
          );
          if (text && results.length)
            media
              .request(
                "POST",
                "/api/dream/notes",
                {
                  text,
                  chat: conversation,
                  results,
                  card: accepted.entries[0].plan.result_set?.character?.id,
                },
                owner,
              )
              .catch(() => {});
        },
        () => {
          if (recentGenerates.get(key) === entry) recentGenerates.delete(key);
        },
      );
      return reply;
    },
  );
  /** The account's character by id or name, with the images it still has, owned for this call. */
  const characterFor = async (value, signal) => {
    const { characters = [] } = await media.request("GET", "/api/characters", undefined, owner, {
      signal,
    });
    const card = findCard(characters, value);
    if (!card) throw new Error(`No character "${value}". Call models to list them.`);
    const referenceIds = card.references.map((asset) => asset.id);
    if (!referenceIds.length)
      throw new Error(
        card.portrait?.status === "making"
          ? `${card.name}'s portrait isn't finished yet. Try again once it is.`
          : `${card.name} has no images left. Ask the user to add some in Studio.`,
      );
    media.adopt(owner, refs, { assets: referenceIds });
    return { ...card, referenceIds };
  };
  /** The chat's project, noting the request; none without a chat or where Dream is unavailable. */
  const attachedProject = (signal) =>
    conversation
      ? media
          .request("POST", "/api/dream/projects/activity", { chat: conversation }, owner, {
            signal,
          })
          .then(
            ({ project }) => project || null,
            () => null,
          )
      : null;
  /**
   * Records a call's queued submissions (each `{ plan, queued }`) as the conversation's next set
   * and answers its number, or 0 when nothing queued.
   */
  const recordSet = (entries) =>
    entries.some(({ queued }) => queued.jobs?.length)
      ? media.addSet(owner, refs, {
          plans: entries.map(({ plan, queued }) => {
            // A rerun draws a new seed.
            const { prompts = [], seed: _seed, ...args } = plan;
            return {
              args,
              prompts,
              jobs: (queued.jobs || []).map((job) => ({
                id: job.job_id,
                prompt: job.prompt_index,
                images: job.images || 1,
              })),
            };
          }),
        })
      : 0;
  /** The set's number, with ways to name its images that the set actually has. */
  const setNote = (number, entries) => {
    if (!number) return "";
    const items = entries.flatMap(({ plan, queued }) =>
      (plan.prompts || []).map((_, index) =>
        (queued.jobs || [])
          .filter((job) => job.prompt_index === index)
          .reduce((sum, job) => sum + (job.images || 1), 0),
      ),
    );
    const last = String.fromCharCode(96 + Math.max(1, items.at(-1) || 1));
    const examples = [
      ...(items.reduce((sum, count) => sum + count, 0) > 1
        ? [`"set ${number} B": second image`]
        : []),
      ...(items.length > 1
        ? [`"set ${number} ${items.length}${last}": item ${items.length}, image ${last}`]
        : []),
    ];
    return `Set ${number}${examples.length ? ` (${examples.join("; ")})` : ""}. `;
  };
  /** A reply naming its set in structuredContent too. */
  const withSet = (reply, number) =>
    number
      ? { ...reply, structuredContent: { ...reply.structuredContent, set: `set ${number}` } }
      : reply;
  const interrupted = (entries, number, error) => {
    const jobs = entries.flatMap(({ queued }) => queued.jobs);
    return withSet(
      {
        content: [
          {
            type: "text",
            text: `${setNote(number, entries)}These jobs were accepted before the reply was interrupted: ${error.message} Share their links and end your turn; never resubmit.\n\n${jobs.map(({ ref, link }) => `[${ref[0].toUpperCase()}${ref.slice(1)}](${link})`).join(" · ")}`,
          },
        ],
        structuredContent: { status: "queued", jobs },
      },
      number,
    );
  };
  const generateOnce = async (input, signal, accepted) => {
    const [project, taste, alike] = await Promise.all([
      attachedProject(signal),
      accountTaste(media, owner, signal),
      converging(media, owner, signal),
    ]);
    const { rules, exclusions, avoid } = taste;
    const choices = chatChoices.read(owner, conversation);
    const remembered = keptChoices(choices, structuredClone(input));
    const constrained = project
      ? projectArgs(project, remembered.args)
      : { args: remembered.args, note: "" };
    const {
      kind,
      tier: wanted,
      aspect,
      request,
      preview,
      profile_ids,
      each_profile,
      title,
      context,
      base,
      axis: namedAxis,
      strengths: strengthChoice,
      ...args
    } = constrained.args;
    const unfinished = preview ? 0 : await media.pendingOutputs(owner, signal);
    const waitingNote =
      unfinished === 1
        ? "1 other chat image is still unfinished in Studio. "
        : unfinished
          ? `${unfinished} other chat images are still unfinished in Studio. `
          : "";
    if (args.reference_asset_ids)
      args.reference_asset_ids = await Promise.all(
        args.reference_asset_ids.map((id) => referenceAsset(id, signal)),
      );
    if (Array.isArray(input.reference_asset_ids))
      chatChoices.rememberReferences(owner, conversation, args.reference_asset_ids);
    const sheet = args.character_sheet === true;
    delete args.character_sheet;
    if (sheet && !args.character)
      throw new Error("character_sheet needs character: the name or id of the card.");
    const card = args.character ? await characterFor(args.character, signal) : null;
    if (sheet) {
      if (args.prompts || args.shots)
        throw new Error("character_sheet queues the sheet alone: leave out prompts and shots.");
      const made = await media.request(
        "POST",
        `/api/characters/${encodeURIComponent(card.id)}/sheet`,
        conversation
          ? { chat: { conversationId: conversation, ...(turn ? { turnId: turn } : {}) } }
          : {},
        owner,
        { signal },
      );
      media.adopt(owner, refs, { jobs: [made.jobId] });
      media.recordPrompt(made.jobId, {
        kind: "image",
        ...(conversation ? { chat: conversation, ...(turn ? { turn } : {}) } : {}),
      });
      const { ref, link } = media.handle(owner, refs, made.jobId);
      return {
        content: [
          {
            type: "text",
            text: `Queued ${card.name}'s character sheet on ${made.profile}: Studio writes its prompt, then keeps its face, front, side and back views on the card, and generate sends the view a prompt names. ${waitingNote}Share the link and end your turn.\n\n[${ref[0].toUpperCase()}${ref.slice(1)}](${link})`,
          },
        ],
        structuredContent: { status: "queued", jobs: [{ job_id: made.jobId, ref, link }] },
      };
    }
    const anyModel = args.any_model === true;
    delete args.character;
    delete args.any_model;
    // Shots: Studio writes each prompt from its parts, an outfit or scene card's own description
    // where one is named, so the assistant never rewords the character, outfit or place.
    const shots = args.shots;
    delete args.shots;
    // Outfit and scene card images as references: off until a live proof run shows they help.
    const cardImages = process.env.STUDIO_CARD_IMAGES === "1";
    if (shots && args.prompts) throw new Error("Pass shots or prompts, not both.");
    const lists = {};
    const cardNamed = async (kind, value) => {
      if (!value?.trim()) return undefined;
      lists[kind] ??=
        (
          await media.request("GET", `/api/${kind}`, undefined, owner, { signal }).catch(() => ({}))
        )[kind] ?? [];
      return findCard(lists[kind], value);
    };
    const parts = shots
      ? await Promise.all(
          shots.map(async (shot) => {
            const [outfit, scene] = await Promise.all([
              cardNamed("outfits", shot.outfit),
              cardNamed("scenes", shot.scene),
            ]);
            return {
              ...shot,
              outfit: outfit ? outfit.description : shot.outfit,
              scene: scene ? scene.description : shot.scene,
              // Each card's image, which joins the character's only behind STUDIO_CARD_IMAGES.
              images: { outfit: outfit?.references?.[0]?.id, scene: scene?.references?.[0]?.id },
            };
          }),
        )
      : null;
    const shotPrompts = (fromImage) =>
      parts.map(({ images: _images, ...shot }) =>
        composePrompt({ character: card?.description, ...shot, fromImage }),
      );
    if (parts) args.prompts = shotPrompts(true);
    if (!args.prompts)
      throw new Error(
        `Missing prompts. Write finished prompts to the model's guide and send prompts: ["..."], an array of strings, with the user's words as request in one generate call; count is images per prompt${
          Object.keys(input).length
            ? ""
            : ' (this call had no arguments; an earlier call shown as "input shortened to save context" is the chat\'s shortened copy, not arguments to send, and a call cut short needs fewer or shorter prompts)'
        }. Do not repeat this unchanged invalid call.`,
      );
    // A set template: each prompt is a delta of the one base prompt, which the chat writes once.
    const deltas = base ? args.prompts : null;
    if (base) {
      if (parts) throw new Error("Pass shots or base, not both.");
      args.prompts = deltas.map((delta) =>
        base.includes("{}")
          ? base.replaceAll("{}", delta)
          : `${base.replace(/[\s,.;]+$/, "")}, ${delta}`,
      );
    }
    if ([args.profile_id, profile_ids, each_profile].filter(Boolean).length > 1)
      throw new Error(
        "Pass one of profile_id (one model), profile_ids (several) or each_profile (every model of kind and tier), then call generate again.",
      );
    const several = Boolean(profile_ids || each_profile);
    const axis = namedAxis || (strengthChoice ? "LoRA Strength" : "");
    if (axis) {
      const values = [strengthChoice, profile_ids, args.prompts.length > 1].filter(Boolean).length;
      if (values !== 1 || each_profile || shots)
        throw new Error(
          `axis varies one thing: pass ${compareVariants.min}–${compareVariants.max} prompts (or deltas with base), or one prompt with profile_ids or strengths.`,
        );
      if ((kind || "image") !== "image") throw new Error("axis compares images; leave kind out.");
      if (strengthChoice && !args.loras?.length)
        throw new Error("strengths vary the first LoRA: pass it in loras.");
      if (args.prompts.length > compareVariants.max)
        throw new Error(`axis compares at most ${compareVariants.max} values.`);
      args.count = 1;
    }
    if (
      args.captions &&
      strengthChoice !== "sweep" &&
      args.captions.length !== (strengthChoice?.length ?? args.prompts.length)
    )
      throw new Error(
        "Pass one caption per prompt or LoRA strength, with an empty string to skip one.",
      );
    if (several && args.loras?.length)
      throw new Error(
        "LoRAs belong to one model: pass them with profile_id, or leave loras out for several models.",
      );
    // Instructions sent as an exact prompt would run literally, and their number of images would be lost.
    for (const prompt of args.prompts) {
      const instructed = exactPromptInstructions(prompt);
      if (instructed) throw new Error(instructed);
      // Refused before any prompt queues, so no part of a set runs (admission checks each too).
      const minor = minorAgeRefusal(prompt);
      if (minor) throw new Error(minor);
    }
    // Each call of a turn ("200 more") brings new ideas rather than repeating the turn's earlier sets.
    const listProblem =
      promptListProblem(args.prompts) ||
      repeatedSetProblem(args.prompts, turnRuns.get(turnKey)?.sets || []);
    if (listProblem) throw new Error(listProblem);
    // "count: 4" beside four prompts means one image each, not sixteen.
    if (
      args.count > 1 &&
      args.count === args.prompts?.length &&
      args.count * args.prompts.length > maxJobsPerCall
    )
      args.count = 1;
    // Checked before any prompt is written, so an oversized call costs nothing and says how to split.
    assertJobCount(args.prompts?.length || 1, args.count ?? 1, maxSplitJobs);
    const named = args.reference_asset_ids || [];
    // A character needs a model that takes references; its images then fill what room each has.
    const references = named.length + (card?.referenceIds.length ? 1 : 0);
    // Cloud (Grok) profiles only when the user asks for Grok or the cloud.
    const cloud = asksForCloud(request);
    // A model named by profile_id or in the request is used even for a character.
    let modelNamed = args.profile_id !== undefined;
    let targets;
    if (profile_ids) {
      const profiles = await media.profiles(kind || "all", owner);
      targets = profile_ids.map((value) => namedInTier(profiles, value, wanted));
    } else if (each_profile) {
      const local = localUnlessAsked(await media.profiles(kind || "image", owner), { request });
      targets = (wanted ? profilesForTier(local, wanted) : local)
        .filter(
          ({ mediaInputs = [] }) =>
            mediaInputs.length >= references &&
            mediaInputs.filter((slot) => slot.required).length <= references,
        )
        .map((profile) => ({ profile, note: "" }));
      if (!targets.length)
        throw new Error(
          `No ready ${kind || "image"} profile${wanted ? ` in tier ${wanted}` : ""}. Call models to see what is ready.`,
        );
    } else {
      // A model the request names ("fast moss") counts as its profile_id when the chat left it out.
      const fromRequest =
        args.profile_id === undefined && request && !args.loras?.length
          ? profileFromRequest(
              localUnlessAsked(await media.profiles(kind || "image", owner), { request }),
              request,
              wanted,
            )
          : null;
      const fits = fromRequest && (fromRequest.profile.mediaInputs || []).length >= references;
      if (fits) modelNamed = true;
      // The model this chat chose earlier, unless this call names another, a tier or a character.
      const keptId = choices[kind || "image"]?.profile_id;
      let keptModel = null;
      if (args.profile_id === undefined && !fits && keptId && !input.tier && !card)
        try {
          const candidate = namedInTier(await media.profiles(kind || "all", owner), keptId);
          const profile = media.runProfile(candidate.profile, {
            references: references > 0,
            loras: Boolean(args.loras?.length),
          });
          const { max, required } = referenceCount(
            references ? { ...profile, ...profile.imageModes?.reference } : profile,
          );
          if (references >= required && references <= max) {
            keptModel = candidate;
            remembered.kept.push(candidate.profile.label || keptId);
          }
        } catch {
          // Gone or no longer granted: Studio picks as usual.
        }
      targets = [
        args.profile_id === undefined
          ? fits
            ? fromRequest
            : keptModel ||
              picked(
                await media.choices(owner, {
                  kind,
                  tier: wanted,
                  references,
                  loras: args.loras || [],
                  cloud,
                }),
              )
          : namedInTier(await media.profiles(kind || "all", owner), args.profile_id, wanted),
      ];
    }
    // A character keeps its identity only on a model that edits with references (an img2img start
    // image carries its pose and layout over), best on a family that keeps characters: without a
    // named model, Studio picks from those first (characterProfiles), in the wanted tier.
    if (card?.referenceIds.length && !modelNamed && !several && (kind || "image") === "image") {
      const defaultId = (await media.catalogue(owner)).defaults?.imageModel;
      const ranked = characterProfiles(
        localUnlessAsked(await media.profiles("image", owner), { request }),
        [defaultId],
      );
      for (const pool of [ranked.filter(keepsCharacterFaces), ranked]) {
        try {
          const editor = chooseProfile(pool, {
            kind: "image",
            tier: wanted,
            references: 1,
            defaultId,
          });
          targets = [{ profile: editor, note: "" }];
          break;
        } catch {
          // None in reach (or in the tier): the next pool, else the usual pick, whose reply says img2img.
        }
      }
    }
    let projectNote = waitingNote;
    if (project) {
      const kept = projectTargets(project, targets, await media.profiles("all", owner), {
        references,
      });
      targets = kept.targets;
      projectNote = `${waitingNote}${constrained.note}${kept.note}${briefLine(project)}`;
    }
    if (remembered.kept.length)
      projectNote = `Kept from earlier: ${remembered.kept.join(", ")}. ${projectNote}`;
    // The rules come back with a chat's first generate, when they change, and again as a guide would.
    if (rules.length && review(`rules:${JSON.stringify(rules)}`))
      projectNote = `${rulesLine(rules)}${projectNote}`;
    const avoided = [...new Set([...exclusions, ...avoid])];
    if (avoided.length && review(`exclusions:${JSON.stringify(avoided)}`))
      projectNote = `The user excludes these subjects, props or settings: ${avoided.join(", ")}. Leave them out of positive prompts. Keep the user's own wording and vary only details they left open. If an explicit request conflicts with an exclusion, tell the user before changing it. ${projectNote}`;
    if (alike && review("converging"))
      projectNote = `Recent results are converging on one look. Vary the open choices in setting, light, framing, action or styling. Keep identities and details fixed by the user's instructions or references. ${projectNote}`;
    if (axis && targets.some(({ profile }) => !mcpControls(profile).seed))
      throw new Error("These models cannot hold a seed for a controlled comparison.");
    if (axis && several && targets.length < compareVariants.min)
      throw new Error(`Compare at least ${compareVariants.min} models.`);
    const namedProfile =
      input.profile_id !== undefined && targets.length === 1 ? targets[0].profile.id : undefined;
    // Each target as the backend its run uses, whose sizes and slots then apply; a combined
    // profile's reply names it for a run with LoRAs or one that leaves the default backend.
    targets = targets.map((target) => {
      const profile = media.runProfile(target.profile, {
        references: references > 0,
        loras: Boolean(args.loras?.length),
      });
      const moved = profile.backend !== target.profile.backend;
      const backend =
        target.profile.backend && (args.loras?.length || moved)
          ? `${profile.label || profile.id} runs on ${profileBackendLabels[profile.backend] || profile.backend}${args.loras?.length ? " with LoRAs" : " with references"}${profile.ready === false ? `, which isn't ready${profile.readyReason ? ` (${profile.readyReason})` : ""}` : ""}. `
          : "";
      return { ...target, profile, note: `${target.note || ""}${backend}` };
    });
    // The model a warning names when the chosen one can't hold a character's (or reference's) face.
    const keeper =
      card?.referenceIds.length || named.length
        ? characterProfiles(localUnlessAsked(await media.profiles("image", owner), { request }))[0]
        : undefined;
    targets = targets.filter(
      (target, index) =>
        targets.findIndex((other) => other.profile.id === target.profile.id) === index,
    );
    // Identity lock: a character runs only where its image is edited with, never as text alone or
    // an img2img start image, unless the user insists on the model.
    const unable =
      card?.referenceIds.length && !anyModel
        ? targets.filter(({ profile }) => !keepsIdentity(profile))
        : [];
    if (unable.length)
      throw new Error(
        `${unable.map(({ profile }) => profile.label || profile.id).join(", ")} can't hold ${card.name}'s face: it takes no reference to edit with, so each image would show someone else. Leave the model out (Studio picks ${keeper ? keeper.label || keeper.id : "one that edits with references"}), or pass any_model: true only if the user insists on it.`,
      );
    // A lone prompt on one image model, for a request that names no number, takes the account's Default Count.
    const preferredCount =
      targets.length === 1 && args.prompts.length === 1 && !requestedCount(request)
        ? targets[0].profile.imagePreference?.imageCount
        : undefined;
    const count = (args.count ??= preferredCount ?? mcpGenerationCount);
    const jobs = targets.length * (args.prompts?.length || 1) * count;
    if (jobs > maxSplitJobs)
      throw new Error(
        `${targets.length} models × ${jobs / targets.length} images each would queue ${jobs}; one call queues at most ${maxSplitJobs}. Lower count, pass fewer profile_ids, or name a tier.`,
      );
    const tooMany = turnCountProblem(request, turnRuns.get(turnKey)?.images || 0, jobs);
    if (tooMany) throw new Error(tooMany);
    // A preview's prompts run as shown when the same call follows without preview.
    // Keyed by what the call runs, so references a preview named carry into the call that confirms it.
    const previewKey = `${refs || owner}\n${stableJson({ ...remembered.args, preview: undefined })}`;
    const previewed = previews.get(previewKey);
    if (!preview) previews.delete(previewKey);
    const plans =
      !preview && previewed && Date.now() - previewed.at < previewMs
        ? previewed.plans
        : await Promise.all(
            targets.map(async ({ profile, note }) => {
              const sized = runSize(profile, aspect, args.resolution);
              // A character sends its first image (characterImages; the run adds its others where
              // there is room) only to a model that keeps its face: into its Identity slot, the
              // named references filling the others in order, or after them on a model that edits
              // with references. As an img2img start image its pose and layout would carry over.
              const identity = identitySlot(profile);
              const room = keepsIdentity(profile)
                ? Math.min(Math.max(0, referenceCount(profile).max - named.length), characterImages)
                : 0;
              const others = (profile.mediaInputs || [])
                .map((slot) => slot.id)
                .filter((id) => id !== identity);
              const plan = {
                ...args,
                ...sized,
                ...(card
                  ? {
                      reference_asset_ids: [...named, ...card.referenceIds.slice(0, room)],
                      ...(identity && room
                        ? { reference_slots: [...others.slice(0, named.length), identity] }
                        : {}),
                    }
                  : {}),
                // With its image, its lead starts each prompt verbatim, as in the composer; without,
                // the chat's prompts run as written, so its own edits to looks hold. Shots are
                // written whole.
                ...(parts
                  ? { prompts: shotPrompts(room > 0) }
                  : card && room
                    ? {
                        prompts: args.prompts.map((prompt) =>
                          withCharacter(prompt, card.description, room > 0),
                        ),
                      }
                    : {}),
                profile_id: profile.id,
              };
              const start =
                card?.referenceIds.length && !room
                  ? `${profile.label || profile.id} can't take ${card.name}'s image as a reference, so only your prompts carry the character (write their looks in) and the face will change from image to image. Tell the user; ${keeper ? `${keeper.label || keeper.id}` : "a model that edits with references"} keeps the same face in new outfits and scenes. `
                  : "";
              // A reference on an img2img model is its start image, and the reply says what follows.
              const img2img =
                named.length && startImageSlot(profile)
                  ? `${profile.label || profile.id} starts from the reference image (img2img): its pose and layout carry over and a face drifts in new scenes. Tell the user; ${keeper ? `${keeper.label || keeper.id}` : "a model that edits with references"} keeps the same person in new outfits and scenes. `
                  : "";
              // A shot's outfit and scene card images follow the character's where the profile has
              // slots that take them (cardImageSlots); a card without one stays words, and says so.
              let cards = "";
              if (cardImages && parts && room) {
                const slots = profile.mediaInputs || [];
                const taken = plan.reference_asset_ids.map(
                  (_id, index) => plan.reference_slots?.[index] || slots[index]?.id,
                );
                const words = new Set();
                const extra = parts.map(({ images }) => {
                  const placed = cardImageSlots(profile, taken, {
                    outfit: Boolean(images.outfit),
                    scene: Boolean(images.scene),
                  });
                  return [
                    ["outfit", "Outfit"],
                    ["scene", "Scene"],
                  ].flatMap(([key, label]) => {
                    if (!images[key]) return [];
                    if (!placed[key]) {
                      words.add(label);
                      return [];
                    }
                    return [{ assetId: images[key], slot: placed[key] }];
                  });
                });
                if (extra.some((items) => items.length)) {
                  media.adopt(owner, refs, {
                    assets: extra.flat().map((item) => item.assetId),
                  });
                  plan.prompt_references = extra;
                }
                cards = [...words]
                  .map((label) => `${cardImageNote(label, slots.length)} `)
                  .join("");
              }
              return {
                profile,
                note: `${note || ""}${start}${img2img}${cards}`,
                plan,
                source: "exact",
              };
            }),
          );
    for (const { plan } of plans) {
      if (project) assertAvoided(project, plan.prompts);
      assertTasteExclusions(taste, plan.prompts);
      if (
        !plan.reference_asset_ids?.length &&
        !plan.prompt_references?.some((refs) => refs.length)
      ) {
        const relative = plan.prompts.findIndex((prompt) =>
          /^(?:the )?same as (?:above|before|the previous (?:prompt|image))\b/i.test(prompt),
        );
        if (relative >= 0)
          throw new Error(
            `Prompt ${relative + 1} depends on an earlier prompt or image. Describe the complete scene, or attach the image if the user wants to edit it.`,
          );
      }
    }
    let strengthOptions;
    if (strengthChoice) {
      const [{ profile, plan }] = plans;
      const active = plan.reference_asset_ids?.length
        ? { ...profile, ...profile.imageModes?.reference }
        : profile;
      const infos = await media.loraInfos(owner);
      const [primary, ...others] = plan.loras;
      const [target] = prepareLoras(active, infos, [primary]);
      if (!target) throw new Error("The first LoRA cannot run on the chosen profile.");
      const remaining = prepareLoras(active, infos, others);
      if (remaining.some(({ name }) => name === target.name))
        throw new Error("List the LoRA being tested only once.");
      const values =
        strengthChoice === "sweep" ? loraStrengthSweep(infos[target.name]) : strengthChoice;
      if (values.length < compareVariants.min || new Set(values).size !== values.length)
        throw new Error("Compare at least two distinct LoRA strengths.");
      if (plan.captions && plan.captions.length !== values.length)
        throw new Error("Pass one caption per LoRA strength, with an empty string to skip one.");
      const takesNegative = Boolean(mcpControls(active).negative_prompt);
      const negative =
        plan.negative_prompt ??
        recommendedNegative(active.prompting, {
          cfg: plan.cfg ?? active.defaults?.cfg,
          takesNegative,
          stack: remaining,
          infos,
        });
      strengthOptions = values.map((strength) => {
        const loras = strength === 0 ? others : [{ ...primary, strength }, ...others];
        if (strength !== 0) prepareLoras(active, infos, loras);
        return {
          label: strength === 0 ? "Without LoRA" : String(strength),
          loras,
          ...(takesNegative ? { negative_prompt: negative } : {}),
          ...(profile.backend ? { profile_backend: profile.backend } : {}),
        };
      });
    }
    if (preview) {
      if (previews.size >= 256) previews.delete(previews.keys().next().value);
      previews.set(previewKey, { at: Date.now(), plans });
      const lines = plans.map(
        ({ profile, plan }) =>
          `${profile.label || profile.id}: ${[...new Set(plan.prompts)].map((prompt) => shortPrompt(prompt)).join(" | ")}${strengthOptions ? ` (LoRA: ${strengthOptions.map(({ label }) => label).join(", ")})` : ""}`,
      );
      return {
        content: [
          {
            type: "text",
            text: `${projectNote}Preview only; nothing is queued. Show the user these prompts and wait. To queue exactly these prompts, call generate again with the same arguments without preview; for changes, call it with revised prompts.${args.reference_asset_ids?.length ? ` References: ${args.reference_asset_ids.join(", ")}.` : ""}\n\n${lines.join("\n")}`,
          },
        ],
      };
    }
    // Only a call that queues teaches the chat's later calls (a refused or previewed one doesn't).
    chatChoices.remember(owner, conversation, input, namedProfile);
    // A call of several results, or one the chat titled or described, is one titled set, with the
    // character it was made with and the chat's context; the gallery titles each prompt's results
    // by titles, by a one-prompt call's title, or by its prompt where they are missing.
    const resultSet = (axis || jobs > 1 || title || args.titles || args.captions || context) && {
      id: crypto.randomUUID(),
      // A character's set is named for it unless the chat named the set.
      title: title || card?.name || promptWords(args.prompts[0]) || "Untitled Generation",
      source: actor.client || "MCP",
      ...(card ? { character: { id: card.id, name: card.name } } : {}),
      ...(context ? { context } : {}),
    };
    for (const item of plans)
      if (resultSet) {
        item.plan.result_set = resultSet;
        if (input.title && !item.plan.titles && item.plan.prompts.length === 1)
          item.plan.titles = [input.title];
      }
    // Request and prompts together: the prompts run, and the request stays on the record.
    const recordOf = ({ plan }) => {
      const assistant = actor.assistant
        ? chatAssistant.record(owner, plan.prompts || [], plan.loras || [])
        : null;
      return {
        ...(request ? { request } : {}),
        ...(assistant ? { assistant } : {}),
      };
    };
    if (several || axis) {
      // One set per model or value, queued in order so each model loads once; links come back at
      // once. Every set shares one seed, so image N of each is a like-for-like comparison.
      const seed = args.seed ?? crypto.randomInt(2 ** 31);
      const [{ profile, note, plan }] = plans;
      const runs = several
        ? plans
        : strengthOptions
          ? strengthOptions.map(({ label, ...settings }, index) => ({
              profile,
              note,
              label,
              plan: {
                ...plan,
                ...settings,
                captions: plan.captions && [plan.captions[index]],
                ...(plan.result_set ? { result_set: { ...plan.result_set, first: index } } : {}),
              },
            }))
          : plan.prompts.map((prompt, index) => ({
              profile,
              note,
              label: deltas?.[index] || plan.titles?.[index] || promptWords(prompt),
              plan: {
                ...plan,
                prompts: [prompt],
                titles: plan.titles && [plan.titles[index]],
                captions: plan.captions && [plan.captions[index]],
                ...(plan.result_set ? { result_set: { ...plan.result_set, first: index } } : {}),
              },
            }));
      const sets = [];
      for (const item of runs) {
        const set = {
          profile: item.profile,
          note: item.note,
          label: item.label,
          plan: { ...item.plan, seed, ...(axis ? { comparison: true } : {}) },
          queued: (
            await submit(
              item.profile,
              { ...item.plan, seed, ...(axis ? { comparison: true } : {}) },
              recordOf(item),
              {
                guide: false,
              },
            )
          ).queued,
        };
        sets.push(set);
        if (set.queued.jobs.length) accepted.entries.push(set);
      }
      const number = recordSet(sets);
      accepted.set = number;
      return withSet(
        await respondSets(
          sets,
          `${setNote(number, sets)}${projectNote}`,
          signal,
          await comparisonOf(sets, { axis, project }),
          axis,
        ),
        number,
      );
    }
    const [{ profile, note: tierNote, plan, source }] = plans;
    // A face is small in a full-body or wide shot of a person, so the final prompt turns face detail on unless the caller chose.
    // Face detail runs within smart upscale, so it joins only an upscale the caller asked for and never adds one.
    let faceNote = "";
    if (
      plan.face_detail === undefined &&
      plan.upscale_quality &&
      !references &&
      mcpControls(profile).face_detail &&
      plan.prompts.some(fullBodyPerson)
    ) {
      faceNote = "Face detail on for the full-body person. ";
      plan.face_detail = true;
    }
    const submission = await submit(profile, plan, recordOf({ plan }));
    if (submission.queued.jobs.length)
      accepted.entries.push({ profile, plan, queued: submission.queued });
    const number = recordSet([{ plan, queued: submission.queued }]);
    accepted.set = number;
    return withSet(
      await respond(
        submission.queued,
        profile,
        signal,
        submission.guide,
        source,
        `${setNote(number, [{ plan, queued: submission.queued }])}${projectNote}${tierNote || ""}${faceNote}`,
      ),
      number,
    );
  };
  /**
   * Runs a conversation's set again as a new set, with a new seed: every image, or only its failed
   * or disliked ones, each prompt changed by `swap` (case-insensitive) and then `add`.
   */
  const rerunSet = async ({ number, set }, { only, add, swap = [], request, title }, signal) => {
    const items = setItems(set);
    const jobIds = [...new Set(items.flatMap((item) => item.jobs.map((job) => job.id)))];
    // How many images of each item run again.
    let again;
    if (only === "failed") {
      const failed = new Set();
      for (const jobId of jobIds) {
        const job = await media.job(owner, jobId, 0, { signal });
        if (["failed", "cancelled", "missing"].includes(job.status)) failed.add(jobId);
      }
      again = (job) => (failed.has(job.id) ? job.images : 0);
    } else if (only === "disliked") {
      const disliked = new Map();
      for (const jobId of jobIds) {
        const { items: outputs = [] } = await media.request(
          "GET",
          `/api/gallery/jobs/${encodeURIComponent(jobId)}`,
          undefined,
          owner,
          { signal },
        );
        disliked.set(jobId, outputs.filter((output) => output.rating === "disliked").length);
      }
      again = (job) => disliked.get(job.id) || 0;
    } else again = (job) => job.images;
    const counts = items.map((item) => item.jobs.reduce((sum, job) => sum + again(job), 0));
    if (!counts.some(Boolean)) throw new Error(`set ${number} has no ${only} images to rerun.`);
    const pattern = (from) => new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const prompts = set.plans.map((plan) => plan.prompts);
    if (swap.some(({ from }) => !from.trim())) throw new Error("Give each swap a from.");
    for (const { from } of swap)
      if (!prompts.flat().some((prompt) => pattern(from).test(prompt)))
        throw new Error(`No prompt in set ${number} has "${from}".`);
    const changed = (prompt) => {
      let next = prompt;
      for (const { from, to } of swap) next = next.replace(pattern(from), () => to);
      return add ? `${next.replace(/[\s,.;]+$/, "")}, ${add}` : next;
    };
    const checked = prompts.flat().map(changed);
    for (const prompt of checked) {
      const minor = minorAgeRefusal(prompt);
      if (minor) throw new Error(minor);
    }
    const [project, taste] = await Promise.all([
      attachedProject(signal),
      accountTaste(media, owner, signal),
    ]);
    if (project) assertAvoided(project, checked);
    assertTasteExclusions(taste, checked);
    // Each plan's chosen prompts, grouped by how many images each runs, become a submission.
    const all = await media.profiles("all", owner);
    const seed = crypto.randomInt(2 ** 31);
    const setId = crypto.randomUUID();
    const runs = [];
    for (const [index, plan] of set.plans.entries()) {
      const listed = all.find((profile) => profile.id === plan.args.profile_id);
      const chosen = items
        .map((item, place) => ({ ...item, count: counts[place] }))
        .filter((item) => item.plan === index && item.count);
      if (!chosen.length) continue;
      if (!listed)
        throw new Error(
          `${plan.args.profile_id}, which set ${number} ran on, isn't ready now. Call generate instead.`,
        );
      const profile = media.profileForBackend(listed, plan.args.profile_backend);
      if (project) {
        const { args } = projectArgs(project, plan.args);
        const required = {
          ...args,
          ...(project.constraints.aspect
            ? profileAspectSize(profile, { aspect: project.constraints.aspect })
            : {}),
        };
        const { targets } = projectTargets(project, [{ profile }], all, {
          references: plan.args.reference_asset_ids?.length || 0,
        });
        if (
          targets[0].profile.id !== profile.id ||
          ["width", "height", "resolution"].some((key) => required[key] !== plan.args[key]) ||
          stableJson(required.loras || []) !== stableJson(plan.args.loras || [])
        )
          throw new Error(
            `set ${number} conflicts with ${project.name}'s current constraints. Call generate to follow them, or change the project before rerunning the set as it ran.`,
          );
      }
      for (const count of [...new Set(chosen.map((item) => item.count))]) {
        const group = chosen.filter((item) => item.count === count);
        const { captions, titles, result_set, ...args } = plan.args;
        runs.push({
          profile,
          plan: {
            ...args,
            prompts: group.map((item) => changed(plan.prompts[item.prompt])),
            count,
            ...(titles ? { titles: group.map((item) => titles[item.prompt]) } : {}),
            ...(captions ? { captions: group.map((item) => captions[item.prompt]) } : {}),
            ...(plan.args.prompt_references
              ? { prompt_references: group.map((item) => plan.args.prompt_references[item.prompt]) }
              : {}),
            ...(result_set || title
              ? {
                  result_set: {
                    ...result_set,
                    id: setId,
                    title: title || result_set?.title || `Set ${number}`,
                    source: actor.client || "MCP",
                  },
                }
              : {}),
            ...(set.plans.length > 1 ? { seed } : {}),
          },
        });
      }
    }
    const record = { ...(request ? { request } : {}) };
    for (const run of runs) {
      try {
        run.queued = (await submit(run.profile, run.plan, record, { guide: false })).queued;
      } catch (error) {
        const sent = runs.filter((run) => run.queued?.jobs.length);
        if (!sent.length) throw error;
        return interrupted(sent, recordSet(sent), error);
      }
      if (run.queued.error) break;
    }
    const sent = runs.filter((run) => run.queued);
    const fresh = recordSet(sent);
    const note = `${setNote(fresh, sent)}It reruns set ${number}${only ? `'s ${only} images` : ""}${add || swap.length ? ", changed" : ""}. `;
    try {
      return withSet(
        sent.length === 1
          ? await respond(sent[0].queued, sent[0].profile, signal, "", "exact", note)
          : await respondSets(sent, note, signal),
        fresh,
      );
    } catch (error) {
      return interrupted(sent, fresh, error);
    }
  };
  tool(
    server,
    "reuse",
    "reuse result",
    `Follow up on one finished result. again reruns it with the revised prompt and a new seed unless preserve_seed. A set ref ("set 3") reruns it; only filters, add and swap change prompts. animate moves an image; extend continues from the last frame. Give motion in prompt or theme, length in seconds, tier or profile_id for the model, runs_on only if asked. reference returns its reference_asset_id; upscale enlarges it in place when asked.`,
    {
      ...output,
      job_id: z
        .string()
        .min(1)
        .max(200)
        .describe('Its number ("#12"), a variants letter ("B") or a job_id; never "all".'),
      mode: z.enum(["again", "animate", "extend", "reference", "upscale"]).default("again"),
      request: z.string().trim().min(1).max(2000).optional(),
      prompt: z.string().trim().min(1).optional(),
      tier: tier.optional(),
      profile_id: z.string().min(1).optional(),
      preserve_seed: z.boolean().default(false),
      count: jobCount.default(1),
      theme: theme.optional(),
      length: z.number().optional(),
      runs_on: z.enum(["local", "cloud"]).optional(),
      upscale_quality: z.enum(upscaleQualities).optional(),
      title: setTitle.optional(),
      only: z.enum(["failed", "disliked"]).optional(),
      add: z.string().trim().optional(),
      swap: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
    },
    async (
      {
        job_id,
        only,
        add,
        swap,
        title,
        output_index: chosenIndex,
        mode,
        upscale_quality,
        tier: wanted,
        profile_id,
        preserve_seed,
        request,
        prompt,
        count,
        theme,
        length,
        runs_on,
      },
      signal,
    ) => {
      const whole = media.chatSet(owner, refs, job_id);
      if (whole && !whole.item) {
        const others = Object.entries({
          prompt,
          theme,
          length,
          runs_on,
          upscale_quality,
          profile_id,
          tier: wanted,
          preserve_seed,
          count: count > 1,
          mode: mode !== "again",
        })
          .filter(([, value]) => value)
          .map(([name]) => name);
        if (others.length)
          throw new Error(
            `A set reruns as it ran, taking only only, add, swap, request and title; leave out ${others.join(", ")}.`,
          );
        return rerunSet(whole, { only, add, swap, request, title }, signal);
      }
      if (only || add || swap)
        throw new Error('only, add and swap are for a set ref ("set 3"). Call reuse again.');
      const found = await resolveOutput(job_id, signal);
      const id = found.jobId;
      if (found.index !== undefined && chosenIndex > 0 && found.index !== chosenIndex)
        throw new Error(
          `${job_id} already names one image; leave output_index out, or name the result's job with the image you want.`,
        );
      const output_index = found.index ?? chosenIndex ?? 0;
      // A reference is the result's image as it is, so other arguments change nothing; they are
      // named back rather than refused, and the chat carries on to generate.
      if (mode === "reference") {
        const ignored = Object.entries({
          tier: wanted,
          profile_id,
          request,
          prompt,
          preserve_seed,
          count: count > 1,
          theme,
          length,
          runs_on,
          upscale_quality,
          title,
        })
          .filter(([, value]) => value)
          .map(([name]) => name);
        const reference = await media.resultReference(owner, id, output_index, signal);
        return mcpJson(
          ignored.length
            ? {
                ...reference,
                note: `Ignored ${ignored.join(", ")}: mode reference takes only job_id and output_index. Pass the asset's id to generate as reference_asset_ids, with your prompts there.`,
              }
            : reference,
        );
      }
      const animating = mode === "animate" || mode === "extend";
      if (theme && (!animating || prompt))
        throw new Error("theme is for mode animate or extend without prompt. Call reuse again.");
      if (length && !animating)
        throw new Error("length is for mode animate or extend. Call reuse again.");
      if (runs_on && !animating)
        throw new Error("runs_on is for mode animate or extend. Call reuse again.");
      if (theme === "custom" && !request)
        throw new Error("theme custom needs request: what should happen. Call reuse again.");
      if (upscale_quality && mode !== "upscale")
        throw new Error("upscale_quality is for mode upscale. Call reuse again.");
      if (mode === "upscale") {
        if (
          wanted ||
          prompt ||
          request ||
          profile_id ||
          preserve_seed ||
          theme ||
          count > 1 ||
          title
        )
          throw new Error(
            "mode upscale takes only job_id, output_index and upscale_quality. Call reuse again.",
          );
        media.own(owner, id);
        const { items = [] } = await media.request(
          "GET",
          `/api/gallery/jobs/${encodeURIComponent(id)}`,
          undefined,
          owner,
          { signal },
        );
        const item = items.find(
          (entry) => (entry.index ?? 0) === output_index && entry.status === "done",
        );
        if (!item?.id) throw new Error("This result has no finished output to upscale.");
        const quality = upscale_quality || "balanced";
        const { plan } = await media.request(
          "POST",
          "/api/upscale",
          { galleryItemId: item.id, quality },
          owner,
          { signal },
        );
        return mcpJson({
          upscaling: true,
          quality,
          ...(plan?.estimatedWidth
            ? { size: `${plan.estimatedWidth}×${plan.estimatedHeight}` }
            : {}),
          link: media.pageUrl(owner, id),
          note: "Queued. The upscale shows on this result in the gallery when it finishes; share the link and end your turn.",
        });
      }
      // Studio never rewrites a prompt: the chat writes the change into it; request is the user's words.
      if (request && !prompt && !theme)
        throw new Error(
          "Studio runs prompts exactly as given. Revise the result's full prompt yourself (status shows it) and pass it as prompt (for animate, the motion), with the user's words as request, or leave request out to run the prompt unchanged. Call reuse again.",
        );
      const item = await media.source(owner, id, output_index);
      if (mode === "extend" && item.type !== "video")
        throw new Error(
          "mode extend continues a video; to make an image a video, use mode animate.",
        );
      const own = item.type === "video" ? "video" : "image";
      const kind = animating ? "video" : own;
      if (preserve_seed && (animating || wanted || profile_id))
        throw new Error(
          "preserve_seed is for a same-model revision, not animation or a model/tier change. Call reuse again without preserve_seed.",
        );
      let plan;
      // Animating may name the video model ("grok imagine") in profile_id; naming a cloud profile asks for the cloud.
      const named =
        animating && profile_id
          ? namedInTier(await media.profiles("video", owner), profile_id, wanted)
          : null;
      const cloud =
        asksForCloud(request) ||
        asksForCloud(prompt) ||
        Boolean(named && isCloudProfile(named.profile));
      if (named && runs_on && isCloudProfile(named.profile) !== (runs_on === "cloud"))
        throw new Error(
          `${named.profile.label || named.profile.id} doesn't run on ${runs_on}. Call reuse again without runs_on or profile_id.`,
        );
      if (animating)
        plan = await media.animate(owner, id, output_index, item, {
          tier: wanted,
          count,
          where: runs_on || (cloud ? "cloud" : "auto"),
          length,
          profile: named?.profile,
          note: named?.note,
        });
      else if (wanted || profile_id) {
        const references = (item.settings?.referenceAssets || []).filter(
          (asset) => asset?.assetId,
        ).length;
        const target = profile_id
          ? namedInTier(await media.profiles(kind, owner), profile_id, wanted)
          : await media.choose(owner, { kind, tier: wanted, references, cloud });
        plan = { ...media.retarget(item, target.profile, { count }), tierNote: target.note };
      } else plan = await media.rerun(owner, item, { count });
      const recorded = media.promptRecord(id);
      const moved = animating || Boolean(wanted || profile_id);
      if (preserve_seed) {
        const seed = String(item.settings?.seed ?? "");
        if (!/^\d+$/.test(seed))
          throw new Error("This result has no recorded numeric seed to preserve.");
        const numeric = Number(seed);
        if (!Number.isSafeInteger(numeric) || !Number.isSafeInteger(numeric + count - 1))
          throw new Error(
            "The recorded seed is outside the exact numeric range for a controlled revision.",
          );
        plan.args.seed = numeric;
      }
      let source = "exact";
      if (prompt) plan.args.prompts = [prompt];
      else if (theme) {
        // The viewer's Animate themes: the queue item writes the motion prompt (prompt-animate.js).
        const write = {
          animate: {
            theme,
            instruction: request || "",
            source: item.prompt,
            ...(item.type === "video" ? { extend: true } : {}),
          },
        };
        Object.assign(plan.args, { prompts: [""], write });
        source = "studio";
      }
      // A follow-up keeps its source's character and chat context, as a set of one titled by the call.
      const set = item.resultSet;
      const kept = set?.context;
      if (title || kept) {
        plan.args.result_set = {
          id: crypto.randomUUID(),
          title: title || set?.title || promptWords(plan.args.prompts?.[0] || item.prompt),
          source: actor.client || "MCP",
          ...(set?.character ? { character: set.character } : {}),
          ...(kept ? { context: kept } : {}),
        };
        if (title) plan.args.titles = [title];
      }
      // A plain run again keeps the result's prompt, so it keeps how that prompt was written (Recreate does the same).
      const carried = !prompt && !moved ? item.assistant || recorded?.assistant : null;
      const [project, taste] = await Promise.all([
        attachedProject(signal),
        accountTaste(media, owner, signal),
      ]);
      if (project) assertAvoided(project, plan.args.prompts);
      assertTasteExclusions(taste, plan.args.prompts);
      const known = project?.constraints.profiles.length
        ? (await media.catalogue(owner)).profiles
        : [];
      const validate = project
        ? (profile, input) => assertProjectReuse(project, profile, input, known || [])
        : undefined;
      const submission = await submit(
        plan.profile,
        plan.args,
        {
          parentItemId: item.id,
          ...((request || !prompt) && (request || recorded?.request)
            ? { request: request || recorded.request }
            : {}),
          ...(carried ? { assistant: carried } : {}),
        },
        { validate },
      );
      const dropped = plan.droppedLoras?.length
        ? `Left out ${plan.droppedLoras.length === 1 ? "a LoRA" : `${plan.droppedLoras.length} LoRAs`} made for another model (${plan.droppedLoras.join(", ")}); tell the user. `
        : "";
      return respond(
        submission.queued,
        plan.profile,
        signal,
        submission.guide,
        source,
        `${plan.tierNote || ""}${dropped}`,
      );
    },
  );
  tool(
    server,
    "create_characters",
    "create characters",
    `Up to ${maxNewCharacters} new character cards in one call: name, description (lasting looks), optional age and story, and portrait (your prompt for their first image). sheets then makes each sheet.`,
    {
      characters: z
        .array(
          z.object({
            // Lengths and the age's ceiling are checked where the card is saved (cards.js).
            name: z.string(),
            description: z.string(),
            portrait: z.string(),
            age: z.number().int().min(minCharacterAge).optional(),
            ...Object.fromEntries(characterTraits.map((key) => [key, z.string().optional()])),
          }),
        )
        .min(1)
        .max(maxNewCharacters),
      sheets: z.boolean().optional(),
      profile_id: z.string().min(1).optional(),
    },
    async ({ characters, sheets, profile_id }, signal) => {
      const { characters: existing = [] } = await media.request(
        "GET",
        "/api/characters",
        undefined,
        owner,
        { signal },
      );
      const comparable = (text) => text.trim().normalize("NFKC").toLowerCase();
      const words = (name) =>
        comparable(name)
          .split(/[^\p{L}\p{N}]+/u)
          .filter(Boolean);
      // One name's words within another's ("Ben", "Him Ben"), or the same looks, is the same character.
      const within = (a, b) => a.words.length && a.words.every((word) => b.words.includes(word));
      const sameAs = (a, b) => within(a, b) || within(b, a) || a.description === b.description;
      const known = existing.map(({ name, description }) => ({
        name,
        words: words(name),
        description: comparable(description),
      }));
      for (const { portrait, ...card } of characters) {
        const { name, description, age } = card;
        if (!name.trim() || name.trim().length > maxCardName)
          throw new Error(`Give each character a name of at most ${maxCardName} characters.`);
        if (!description.trim() || description.trim().length > maxCardDescription)
          throw new Error(
            `Describe ${name}'s lasting looks in at most ${maxCardDescription} characters.`,
          );
        if (!portrait.trim()) throw new Error(`Write a portrait prompt for ${name}.`);
        if (age > maxCharacterAge)
          throw new Error(`Give ${name} an age from ${minCharacterAge} to ${maxCharacterAge}.`);
        const trait = characterTraits.find((key) => card[key]?.trim().length > maxCharacterTrait);
        if (trait)
          throw new Error(`Keep ${name}'s ${trait} within ${maxCharacterTrait} characters.`);
        const entry = { name, words: words(name), description: comparable(description) };
        const same = known.find((other) => sameAs(entry, other));
        if (same)
          throw new Error(
            `${name} looks like ${same.name}, already in this request or Library (${same.description}). Use or update ${same.name}, or give a clearly different name and looks.`,
          );
        known.push(entry);
        const refusal = minorAgeRefusal(Object.values(card).join("\n"));
        if (refusal) throw new Error(refusal);
      }
      const names = characters.map(({ name }) => name);
      const reply = await generateOnce(
        {
          prompts: characters.map(({ portrait }) => portrait),
          titles: names,
          title: names.join(", ").slice(0, 80),
          count: 1,
          ...(profile_id ? { profile_id } : {}),
        },
        signal,
        { entries: [], set: 0 },
      );
      const jobs = reply.structuredContent?.jobs || [];
      const saved = [];
      for (const [index, { portrait: _prompt, ...card }] of characters.entries()) {
        if (!jobs[index]) break;
        const made = await media.request(
          "POST",
          "/api/characters",
          {
            ...card,
            referenceIds: [],
            portrait: { jobId: jobs[index].job_id, ...(sheets ? { sheet: true } : {}) },
          },
          owner,
          { signal },
        );
        saved.push(made.character.name);
      }
      const [text, ...rest] = reply.content;
      return {
        ...reply,
        content: [
          {
            type: "text",
            text: `Saved ${saved.join(", ")} in Library › Characters; each portrait becomes its card's first image when it finishes${sheets ? ", then Studio makes its sheet" : ""}. ${text.text}`,
          },
          ...rest,
        ],
        structuredContent: { ...reply.structuredContent, characters: saved },
      };
    },
  );
  return { namedInTier };
}
