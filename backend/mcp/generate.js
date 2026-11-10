// MCP's tools that choose a model and queue work: models, generate and reuse.
import crypto from "node:crypto";
import { z } from "zod";
import {
  closest,
  listedControls,
  loraIndex,
  loraQueryWords,
  maxJobsPerCall,
  mcpControls,
  mcpGenerationCount,
  mcpLoras,
  mcpSize,
} from "./controls.js";
import { assertJobCount, mcpJson, replyRule } from "./media.js";
import { exactPromptInstructions, fullBodyPerson } from "./prompt-checks.js";
import { canonicalProfileId } from "../profile/store.js";
import {
  asksForCloud,
  chooseProfile,
  familyMatches,
  fastestFirst,
  findProfile,
  localUnlessAsked,
  mcpTiers,
  nameWords,
  profileFromRequest,
  serviceState,
  speedWordList,
  profilesForTier,
  profilesNearTier,
  searchProfiles,
  tierOf,
  waitingNote,
  waitingServices,
  withinFamily,
  workerState,
} from "./tiers.js";
import { animateThemes } from "../prompt-animate.js";
import { output, shortPrompt } from "./results.js";
import { promptWords, replyTitle } from "../../shared/titles.ts";
import { imageMimes } from "../reference-names.js";
import { resolutions } from "../../shared/resolution.ts";
import { accessFeatures } from "../account-policy.js";
import { isCloudProfile } from "../../shared/profiles.ts";
import { compareVariants } from "../../shared/compare.ts";
import {
  characterImages,
  characterProfiles,
  characterShots,
  editsReferences,
  withCharacter,
} from "../../shared/characters.ts";

// A preview's prompts wait this long for the user's go-ahead.
const previewMs = 30 * 60 * 1000;
/** A set's expected wait for the reply: "about 40 s", "about 3 min". */
const aboutTime = (ms) =>
  ms < 55_000
    ? `about ${Math.max(5, Math.round(ms / 5000) * 5)} s`
    : ms < 90 * 60_000
      ? `about ${Math.round(ms / 60_000)} min`
      : `about ${Math.round(ms / 3_600_000)} h`;
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
// A free string checked here, so a call with a tier this deployment doesn't have gets the current list.
const tier = z
  .string()
  .trim()
  .toLowerCase()
  .refine((value) => mcpTiers.includes(value), {
    message: `Use one of ${mcpTiers.join(", ")}`,
  })
  .describe(`One of ${mcpTiers.join(", ")}; turbo is Super Fast.`);
// The animation themes reuse takes, checked at call time like tier.
const theme = z
  .string()
  .trim()
  .toLowerCase()
  .refine((value) => Object.hasOwn(animateThemes, value), {
    message: `Use one of ${Object.keys(animateThemes).join(", ")}`,
  })
  .describe(`One of ${Object.keys(animateThemes).join(", ")}.`);
const jobCount = z.number().int().min(1).max(maxJobsPerCall);
const setTitle = z.string().trim().min(1).max(80);
const promptList = z.array(z.string().trim().min(1)).min(1).max(maxJobsPerCall);
/** A JSON array sent as one string, or a single prompt. */
const promptListText = z.string().transform((text) => {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [text];
  } catch {
    return [text];
  }
});
// The models tool shows a guide's gist; a model's first generate sends the whole guide for the chat to write to.
const maxShownGuideCharacters = 500;
const maxListedLoras = 30;
/**
 * A profile guide as one paragraph: the family's summary, rules, pitfalls and example, then its
 * mode's and variant's, without sources; `max` caps it for a preview.
 */
function compactGuide(guide, max = Infinity) {
  if (!guide || typeof guide !== "object") return "";
  const parts = [];
  const add = (value) => {
    for (const item of [value].flat())
      if (typeof item === "string" && item.trim()) parts.push(item.replace(/\s+/g, " ").trim());
  };
  for (const source of [guide, guide.mode, guide.variant])
    if (source && typeof source === "object") {
      add(source.summary);
      add(source.rules);
      add(source.pitfalls);
      if (source.example)
        add(
          `Example: ${typeof source.example === "string" ? source.example : JSON.stringify(source.example)}`,
        );
    }
  const textValue = parts.join(" ");
  return textValue.length > max ? `${textValue.slice(0, max - 1)}…` : textValue;
}

/** Registers models, generate and reuse; returns namedInTier for the assistant tools' profile lookup. */
export function registerGenerateTools({
  tool,
  server,
  media,
  actor,
  resolve,
  publicUrl,
  imageWaitSeconds,
  etaProbeMs,
  generateDedupeMs,
  reviewedGuides,
  recentGenerates,
  previews,
  chatAssistant,
}) {
  const { owner, refs, conversation } = actor;
  // A guide goes to each conversation once (each MCP session without a conversation header, else the account).
  const guideKey = (refs, profileId) => JSON.stringify([refs, profileId]);
  /** Marks a guide sent and reports whether it was new; synchronous, so concurrent calls attach it once. */
  const review = (refs, profileId) => {
    const key = guideKey(refs, profileId);
    if (reviewedGuides.has(key)) return false;
    if (reviewedGuides.size >= 4096) reviewedGuides.delete(reviewedGuides.keys().next().value);
    reviewedGuides.set(key, Date.now());
    return true;
  };
  /** What to say about a queued profile whose worker isn't running; Cloud only as a suggestion the account can take. */
  const waiting = async (profile) =>
    workerState[profile.availability]
      ? waitingNote(profile, (await media.profiles(profile.kind, owner)).some(isCloudProfile))
      : "";
  /** A submission's reply: finished markdown when every job ends within the wait, otherwise result links for the queued jobs, which end the agent's turn. */
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
    const followUp = `To change or animate one later, call reuse with its ref (such as "${submission.jobs[0]?.ref || "result 1"}") and your revised prompt.`;
    // A set Studio expects to finish within the wait comes back finished, so the agent needs no result call;
    // anything longer, or with no trusted estimate, hands back its links at once.
    const [endsAt] = await media.finishTimes(owner, [submission], {
      probeMs: etaProbeMs,
      signal,
    });
    const expected = endsAt === null ? null : Math.max(0, endsAt - Date.now());
    // Studio Chat shows the set as a card that follows it, so its turn never waits.
    const seconds =
      !actor.session && expected !== null && expected <= imageWaitSeconds * 1000
        ? imageWaitSeconds
        : 0;
    // A set that outlasted its wait has no ETA left worth giving.
    const left = seconds ? 0 : expected;
    const markdown = await media.settle(owner, submission, seconds, { scope: refs, signal });
    const structured = {
      status: markdown ? "done" : submission.status,
      profile: {
        id: profile.id,
        label,
        tier: tierOf(profile),
        ...(isCloudProfile(profile) ? { remote: true } : {}),
      },
      prompt_source: promptSource,
      ...(!markdown && left ? { eta_seconds: Math.round(left / 1000) } : {}),
      jobs: submission.jobs.map(({ job_id, ref, link, status }) => ({
        job_id,
        ref,
        link,
        ...(status ? { status } : {}),
      })),
    };
    // The prompt each result ran, shortened; one line when every job shares it.
    const prompted = submission.jobs.filter(({ prompt }) => prompt);
    const distinct = new Set(prompted.map(({ prompt }) => prompt));
    const prompts = !prompted.length
      ? ""
      : `\n\n${distinct.size === 1 ? `Prompt: ${shortPrompt([...distinct][0])}` : prompted.map(({ ref, prompt }) => `${ref[0].toUpperCase()}${ref.slice(1)} prompt: ${shortPrompt(prompt)}`).join("\n")}`;
    // The profile's guide follows its first use in a conversation, so the agent applies it to later prompts.
    const extra = guide
      ? [
          {
            type: "text",
            text: `Prompting guide for ${label} (sent once); apply it to later prompts: ${guide}`,
          },
        ]
      : [];
    // Several results, or any still running, also get one All Results page that fills in as they finish.
    const all = `[All Results](${media.allUrl(owner, refs)})`;
    if (markdown)
      return {
        content: [
          {
            type: "text",
            text: `Done on ${label}. ${note}${replyRule} ${followUp}\n\n${markdown}${submission.jobs.length > 1 ? `\n\n${all}` : ""}${prompts}`,
          },
          ...extra,
        ],
        structuredContent: structured,
      };
    const pending = [
      ...submission.jobs.map(
        ({ ref, link }) => `[${ref[0].toUpperCase()}${ref.slice(1)}](${link})`,
      ),
      all,
    ].join(" · ");
    const message =
      submission.status === "queued"
        ? `Queued on ${label}${left ? `, ready in ${aboutTime(left)}` : ""}. ${note}${await waiting(profile)}Share the links below, not images (none exist yet), and end your turn; do not call result now or in the background. When the user later asks to see results, call result. Never poll or resubmit. ${followUp}`
        : `${submission.error} ${note}Share the links; never resubmit.`;
    return {
      content: [{ type: "text", text: `${message}\n\n${pending}${prompts}` }, ...extra],
      structuredContent: {
        ...structured,
        ...(submission.error ? { error: submission.error } : {}),
      },
    };
  };
  /**
   * `compareVariants` single-image sets become one labelled side-by-side page (/compare/:id), or "" when the run
   * doesn't fit one (videos, several images per model, a refused set) or the comparison can't be saved.
   */
  const comparisonOf = async (sets) => {
    const jobs = sets.map(({ queued }) => queued.jobs || []);
    if (
      sets.length < compareVariants.min ||
      sets.length > compareVariants.max ||
      sets.some(({ profile, queued }) => profile.kind === "video" || queued.error) ||
      jobs.some((list) => list.length !== 1)
    )
      return "";
    try {
      const { id = "" } = await media.request(
        "POST",
        "/api/comparisons",
        {
          jobIds: jobs.map(([job]) => job.job_id),
          labels: sets.map(({ profile }) => (profile.label || profile.id).slice(0, 80)),
        },
        owner,
      );
      return id && `${publicUrl}/compare/${id}`;
    } catch {
      return "";
    }
  };
  /** Several models' sets as one reply: a line of result links per model with its expected wait, without waiting for any. */
  const respondSets = async (sets, note = "", signal, compare = "") => {
    const link = ({ ref, link: url }) => `[${ref[0].toUpperCase()}${ref.slice(1)}](${url})`;
    const now = Date.now();
    const left = (
      await media.finishTimes(
        owner,
        sets.map(({ queued }) => queued),
        { probeMs: etaProbeMs, signal },
      )
    ).map((endsAt) => (endsAt === null ? 0 : Math.max(0, endsAt - now)));
    const lines = sets.map(
      ({ profile, queued }, index) =>
        `${profile.label || profile.id}: ${queued.error || queued.jobs.map(link).join(" · ")}${left[index] ? ` (${aboutTime(left[index])})` : ""}`,
    );
    const first = sets.find(({ queued }) => queued.jobs?.length)?.queued.jobs[0].ref || "result 1";
    const waits = [...new Set(await Promise.all(sets.map(({ profile }) => waiting(profile))))].join(
      "",
    );
    return {
      content: [
        {
          type: "text",
          text: `Queued ${sets.length} sets, one per model. ${note}${waits}Share the links below, not images (none exist yet), and end your turn; do not call result now or in the background. Never poll or resubmit. To change or animate one later, call reuse with its ref (such as "${first}") and your revised prompt.${compare ? " Share the comparison link first: it shows every model side by side with the same seed." : ""}\n\n${compare ? `[Compare Side by Side](${compare})\n` : ""}${lines.join("\n")}\n[All Results](${media.allUrl(owner, refs)})`,
        },
      ],
      structuredContent: {
        status: "queued",
        ...(compare ? { compare } : {}),
        sets: sets.map(({ profile, queued }, index) => ({
          profile: { id: profile.id, label: profile.label || profile.id },
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
  /** Studio's usual pick; with several to choose from, the note says which. */
  const picked = ({ pool, profile }) => ({
    profile,
    note: pool.length < 2 ? "" : `Chose ${profile.label || profile.id}, the default. `,
  });
  /** A named profile, moved to the wanted tier within its family (an exact id stays), with a note when the tier fell back. */
  const namedInTier = (profiles, value, wanted) => {
    // A cloud (Grok) profile only by its exact id or when the name asks for the cloud.
    const found = profileNamed(
      profiles.some((profile) => profile.id === value)
        ? profiles
        : localUnlessAsked(profiles, { name: value }),
      value,
    );
    return found.id === value
      ? { profile: found, note: "" }
      : withinFamily(profiles, found, wanted);
  };
  /**
   * How many references a profile takes, from its graph's media inputs, and per backend where a
   * combined profile's backends differ; its label or description may say otherwise.
   */
  const referenceCount = (profile) => {
    const inputs = profile.mediaInputs || [];
    const backends = (profile.backendOptions || []).filter((option) =>
      Number.isInteger(option.references),
    );
    const differ = new Set(backends.map((option) => option.references)).size > 1;
    return {
      max: inputs.length,
      required: inputs.filter((slot) => slot.required).length,
      ...(differ
        ? {
            by_backend: Object.fromEntries(
              backends.map((option) => [option.label, option.references]),
            ),
          }
        : {}),
      note: "From the profile's graph, so it outranks any count its label or description gives.",
    };
  };
  /** Profiles as the models tool lists them: "id — label" grouped by kind, marked when their worker isn't running. */
  const listed = (profiles) => {
    const list = {};
    for (const profile of profiles) {
      const state = workerState[profile.availability]
        ? ` (${workerState[profile.availability]})`
        : "";
      (list[profile.kind] ||= []).push(
        `${profile.label && profile.label !== profile.id ? `${profile.id} — ${profile.label}` : profile.id}${state}`,
      );
    }
    return list;
  };
  /** Why the account sees no LoRAs, so an empty list is never read as Studio having none. */
  const noLoras = async ({ profile, taking = false } = {}) => {
    const access = await media.access(owner);
    const label = profile && (profile.label || profile.id);
    const reason =
      access && !access.features.loras
        ? "LoRAs are off for this account (its group doesn't grant them, or its own LoRAs switch in Preferences is off), so none can be listed or used. This doesn't mean Studio has none."
        : profile
          ? listedControls(profile).loras
            ? `No installed LoRA fits ${label}.`
            : `${label} takes no LoRAs.`
          : taking
            ? "No installed LoRA fits this account's ready profiles."
            : "No ready profile takes LoRAs right now, so none can be listed; this doesn't mean Studio has none. Call models without lora_query to see each service's state.";
    return { loras: [], loras_note: `${reason}${hiddenLoras(access)}` };
  };
  /** Uncensored LoRAs stay out of an account's lists without Uncensored Models. */
  const hiddenLoras = (access) =>
    access?.features.loras && !access.features.uncensoredModels
      ? " LoRAs marked uncensored stay hidden without Uncensored Models."
      : "";
  /** A lookup that matched none: says so, with how many there are and how to list them. */
  const noMatch = async (query, installed) =>
    `No LoRA matches ${query ? `"${query}"` : "those names"}, but ${installed} ${installed === 1 ? "is" : "are"} installed for this account. Call models with lora_query "all" to list them, or try other words.${hiddenLoras(await media.access(owner))}`;
  /** One page of LoRA index lines. */
  const lorasPage = async (lines, number, installed) => {
    const pages = Math.max(1, Math.ceil(lines.length / maxListedLoras));
    const at = Math.min(number, pages);
    return {
      loras: lines.slice((at - 1) * maxListedLoras, at * maxListedLoras),
      loras_installed: installed,
      page: at,
      pages,
      loras_note: `Each reads name — hint [trigger word].${at < pages ? ` Call models again with lora_page ${at + 1} for more.` : ""} Pass names to generate; Studio adds missing trigger words.${hiddenLoras(await media.access(owner))}`,
    };
  };
  /** A ready profile by id or name, the fastest of one family's matches; otherwise the closest few, fastest first, so one call corrects a guess. */
  const profileNamed = (profiles, value) => {
    const found = findProfile(profiles, value);
    if (found) return found;
    // Words that name several models ("klein" for FLUX.2 and FLUX.3) list them, so one more call picks one.
    const matches = searchProfiles(profiles, value);
    if (matches.length > 1)
      throw new Error(
        `${value} matches several profiles: ${matches
          .slice(0, 6)
          .map((profile) => `${profile.id} (${profile.label || profile.id})`)
          .join(", ")}. Pass one id.`,
      );
    // A miss lists only the family the name points at; another model is never offered as a stand-in.
    const family = familyMatches(profiles, value);
    if (family.length)
      throw new Error(
        `No ready profile matches ${value}. Ready profiles for it: ${family
          .slice(0, 6)
          .map((profile) => `${profile.id} (${profile.label || profile.id})`)
          .join(", ")}.`,
      );
    if (nameWords(value).some((word) => !speedWordList.has(word)))
      throw new Error(
        `No ready profile matches ${value}; that model isn't available to this account. Tell the user instead of using another model.`,
      );
    const near = closest(fastestFirst(profiles), value, (profile) => [
      profile.id,
      profile.label,
      tierOf(profile),
    ]);
    throw new Error(
      `No ready profile matches ${value}.${near.length ? ` Closest: ${near.map((profile) => `${profile.id} (${profile.label || profile.id})`).join(", ")}.` : " Call models for the list."}`,
    );
  };
  /**
   * Queues a submission with the request behind it. The profile's guide goes to a conversation that has
   * not had it, marked before any wait, so the chat writes its later prompts itself.
   */
  const submit = async (profile, args, record = {}, { guide = true } = {}) => {
    const fresh = guide && review(refs, profile.id);
    try {
      const queued = await media.queue(owner, args, refs, {
        ...record,
        ...(actor.session ? { session: actor.session } : conversation ? { conversation } : {}),
      });
      return { queued, guide: fresh ? compactGuide(profile.prompting) : "" };
    } catch (error) {
      // A refused submission delivered no guide, so the next attempt carries it.
      if (fresh) reviewedGuides.delete(guideKey(refs, profile.id));
      throw error;
    }
  };
  tool(
    server,
    "models",
    "find models",
    "What Studio has now. Without profile_id: ready profiles as \"id — label\" by kind (Stopped or Offline marked), those needing setup, each service's state and the account's features and characters (generate's character adds its image and looks: prompts set only outfit and scene; character_views queues its views). With profile_id (id, label or words): its guide's gist, defaults, controls, references and LoRAs. lora_query or lora_names look up LoRAs, in every profile without profile_id; lora_page pages.",
    {
      kind: z.enum(["all", "image", "video"]).default("all"),
      tier: tier.optional(),
      profile_id: z.string().optional(),
      lora_query: z
        .string()
        .max(200)
        .optional()
        .describe('Words from a LoRA\'s name, title or trigger; "all" lists every one.'),
      // Clients validate against the published schema, so extra names are dropped here, not rejected.
      lora_names: z
        .array(z.string().min(1))
        .transform((names) => names.slice(0, 5))
        .optional(),
      lora_page: z.number().int().min(1).max(1000).default(1),
      full_guide: z
        .boolean()
        .optional()
        .describe("The whole prompting guide; rarely needed beyond its gist."),
    },
    async ({
      kind,
      tier: wanted,
      profile_id: named_id,
      lora_query,
      lora_names = [],
      lora_page,
      full_guide,
    }) => {
      const profile_id = canonicalProfileId(named_id);
      let profiles = await media.profiles(kind, owner);
      if (profile_id === undefined) {
        // Cloud (Grok) profiles list apart: generate uses one only when the user asks for Grok or the cloud.
        const cloud = profiles.filter(isCloudProfile);
        profiles = profiles.filter((profile) => !isCloudProfile(profile));
        if (wanted) profiles = profilesNearTier(profiles, wanted);
        // A LoRA lookup without a model searches every ready profile, so one call answers it.
        if (lora_query !== undefined || lora_names.length) {
          const infos = await media.loraInfos(owner);
          const ratings = await media.loraRatings(owner);
          const taking = profiles.filter((profile) => listedControls(profile).loras);
          const installed = new Set(taking.flatMap((profile) => profile.options?.loras || []));
          if (!installed.size) return mcpJson(await noLoras({ taking: taking.length > 0 }));
          // A general lookup ("lora", "all") lists every LoRA, a page at a time.
          if (!loraQueryWords(lora_query).length && !lora_names.length) {
            const lines = new Map();
            for (const profile of taking)
              for (const { name, line } of loraIndex(profile, infos, ratings))
                if (!lines.has(name)) lines.set(name, line);
            return mcpJson(await lorasPage([...lines.values()], lora_page, installed.size));
          }
          const found = new Map();
          const missing = new Set(lora_names);
          for (const profile of taking) {
            const result = mcpLoras(profile, infos, {
              query: lora_query,
              names: lora_names,
              ratings,
            });
            for (const lora of result.loras) {
              if (!found.has(lora.name)) found.set(lora.name, { ...lora, profiles: [] });
              found.get(lora.name).profiles.push(profile.id);
            }
            for (const value of lora_names)
              if (!result.missing?.some((item) => item.name === value)) missing.delete(value);
          }
          return mcpJson({
            loras: [...found.values()].slice(0, maxListedLoras),
            ...(missing.size ? { missing: [...missing] } : {}),
            loras_installed: installed.size,
            loras_note: found.size
              ? "Pass names to generate without profile_id and Studio picks a profile that takes them all."
              : await noMatch(lora_query, installed.size),
          });
        }
        const catalogue = await media.catalogue(owner);
        const access = await media.access(owner);
        // Characters are an extra here: a failed listing leaves them out rather than the models.
        const { characters = [] } =
          !access || access.features.characters
            ? await media.request("GET", "/api/characters", undefined, owner).catch(() => ({}))
            : {};
        const shown = (value) => kind === "all" || kind === value;
        const services = catalogue.backends
          ? Object.fromEntries(
              ["image", "video"]
                .filter(shown)
                .map((value) => [value, serviceState(catalogue.backends[value])]),
            )
          : null;
        const inState = (state) =>
          Object.keys(services || {}).filter((value) => services[value] === state);
        const servicesNote = ["Stopped", "Offline"]
          .filter((state) => inState(state).length)
          .map((state) => waitingServices(inState(state), state))
          .join(" ");
        const unready = (catalogue.profiles || []).filter(
          (profile) => profile.ready === false && shown(profile.kind),
        );
        return mcpJson({
          ...listed(profiles),
          ...(cloud.length
            ? {
                cloud: listed(cloud),
                cloud_note: "Only when the user asks for Grok or the cloud.",
              }
            : {}),
          ...(unready.length
            ? {
                needs_setup: Object.fromEntries(
                  unready.map((profile) => [
                    profile.id,
                    profile.readyReason || "Its files or nodes aren't ready.",
                  ]),
                ),
              }
            : {}),
          ...(services ? { services } : {}),
          ...(servicesNote ? { services_note: servicesNote } : {}),
          ...(access
            ? {
                account: {
                  role: access.role,
                  features: accessFeatures.filter((feature) => access.features[feature]),
                },
              }
            : {}),
          ...(characters.length
            ? {
                characters: characters.map((card) => ({
                  id: card.id,
                  name: card.name,
                  description: card.description,
                  images: card.references.length,
                })),
              }
            : {}),
        });
      }
      if (!profiles.some((profile) => profile.id === profile_id))
        profiles = localUnlessAsked(profiles, { name: profile_id });
      // Words that name several models ("klein", "flux") list them instead of choosing one.
      const named = findProfile(profiles, profile_id);
      const matches = named
        ? []
        : searchProfiles(wanted ? profilesNearTier(profiles, wanted) : profiles, profile_id);
      if (matches.length > 1) return mcpJson(listed(matches));
      const { profile, note: tierNote } = named
        ? named.id === profile_id
          ? { profile: named, note: "" }
          : withinFamily(profiles, named, wanted)
        : namedInTier(profiles, profile_id, wanted);
      const infos =
        profile.options?.loras?.length && profile.capabilities?.lora !== false
          ? await media.loraInfos(owner)
          : {};
      const ratings = Object.keys(infos).length ? await media.loraRatings(owner) : {};
      const controls = listedControls(profile);
      // A LoRA lookup answers only that question; the profile's guide and controls come without one.
      if (lora_query !== undefined || lora_names.length) {
        if (!controls.loras || !profile.options?.loras?.length)
          return mcpJson({ id: profile.id, ...(await noLoras({ profile })) });
        if (!loraQueryWords(lora_query).length && !lora_names.length)
          return mcpJson({
            id: profile.id,
            ...(await lorasPage(
              loraIndex(profile, infos, ratings).map(({ line }) => line),
              lora_page,
              profile.options.loras.length,
            )),
          });
        const { loras, total, more, missing } = mcpLoras(profile, infos, {
          query: lora_query,
          names: lora_names,
          ratings,
        });
        return mcpJson({
          id: profile.id,
          loras,
          loras_total: total,
          ...(more ? { more_matches: more } : {}),
          ...(missing ? { missing } : {}),
          ...(loras.length ? {} : { loras_note: await noMatch(lora_query, total) }),
        });
      }
      review(refs, profile.id);
      // Defaults only for adjustable controls: a fixed value is not something to choose.
      const defaults = Object.fromEntries(
        Object.entries({ ...profile.defaults, count: mcpGenerationCount }).filter(
          ([key]) => controls[key] || ["frames", "fps", "duration"].includes(key),
        ),
      );
      const modes =
        profile.imageModes &&
        Object.fromEntries(
          Object.entries(profile.imageModes).map(([mode, settings]) => {
            // The same merge generate validates against when references select this mode.
            const merged = { ...profile, ...settings };
            return [
              mode,
              {
                controls: listedControls(merged),
                ...(settings?.prompting
                  ? {
                      prompting: full_guide
                        ? settings.prompting
                        : compactGuide(settings.prompting, maxShownGuideCharacters),
                    }
                  : {}),
              },
            ];
          }),
        );
      const { loras, total } = mcpLoras(profile, infos, { ratings });
      const guide = full_guide
        ? profile.prompting
        : compactGuide(profile.prompting, maxShownGuideCharacters);
      const detail = {
        ...Object.fromEntries(
          [
            "id",
            "label",
            "kind",
            "family",
            "description",
            "mediaInputs",
            "aspectPolicy",
            "aspectPresets",
            "native",
          ]
            .filter((key) => key in profile)
            .map((key) => [key, profile[key]]),
        ),
        tier: tierOf(profile),
        references: referenceCount(profile),
        ...(workerState[profile.availability] ? { state: workerState[profile.availability] } : {}),
        // A combined profile: the backend it runs on (an old per-backend id names its own) and the others it has.
        ...(profile.backend
          ? {
              backend: profile.namedBackend || profile.backend,
              backends: profile.backendOptions.map((option) => option.label),
            }
          : {}),
        ...(tierNote ? { note: tierNote.trim() } : {}),
        defaults,
        controls,
        ...(modes
          ? {
              imageModes: modes,
              imageModes_note:
                "A mode applies when its media is supplied, such as reference with references.",
            }
          : {}),
        ...(controls.loras
          ? {
              loras: loras.slice(0, maxListedLoras),
              loras_total: total,
              loras_note: `Each reads name — hint [trigger word]${total > maxListedLoras ? `; the first ${maxListedLoras} shown, lora_query "all" with lora_page or other words finds others` : ""}. Pass names to generate; strength defaults to the recommended value. Studio adds missing trigger words to every prompt.`,
            }
          : {}),
        ...(guide ? { prompting: guide } : {}),
      };
      return mcpJson(detail);
    },
    { readOnlyHint: true },
  );
  tool(
    server,
    "generate",
    "generate",
    `Queue images or videos. Pass your finished prompts (run as written) and the user's words as request. "4 sets of 2" is 4 distinct prompts with count 2; at most ${maxJobsPerCall} images per call. For several models in one call pass profile_ids, or each_profile with kind and tier ("each turbo model"). preview queues nothing. Put a model the user names in profile_id. Pass other controls only as models lists them. upscale_quality only when the user asks to upscale or enlarge (it adds face detail for full-body people). Cloud profiles only if asked.`,
    {
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
        .describe("Run as written; count images each."),
      title: setTitle.optional(),
      titles: z.array(setTitle).max(maxJobsPerCall).optional().describe("One per prompt."),
      preview: z.boolean().optional(),
      count: jobCount.optional().describe("Images per prompt; default 1."),
      kind: z.enum(["image", "video"]).optional(),
      tier: tier.optional(),
      profile_id: z
        .string()
        .min(1)
        .optional()
        .describe("A model id, label or words from them; models lists what is ready."),
      profile_ids: z.array(z.string().min(1)).min(1).max(maxJobsPerCall).optional(),
      each_profile: z.boolean().optional(),
      // Unknown keys (a misspelt "strength") are dropped rather than rejected.
      loras: z
        .array(z.object({ name: z.string().min(1), strength: z.number().finite().optional() }))
        .max(8)
        .optional()
        .describe("Each profile's limit is its controls.loras.max in models."),
      reference_asset_ids: z
        .array(z.string().min(1))
        .max(16)
        .optional()
        .describe(
          `From search uploads, upload${actor.session ? "" : ", upload_link"} or reuse mode reference. models gives each profile's references.max.`,
        ),
      reference_role: z.enum(["edit", "reference"]).optional(),
      // A character's name or id (models lists them).
      character: z.string().min(1).optional(),
      // Generate References: Studio writes one prompt per view of the character (shared/characters.ts).
      character_views: z.boolean().optional(),
      aspect: z
        .string()
        .optional()
        .describe("landscape, portrait, square or a ratio like 16:9; prefer to width/height."),
      resolution: z.enum(resolutions).optional(),
      width: z.number().int().positive().max(16384).optional(),
      height: z.number().int().positive().max(16384).optional(),
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
      sampler: z.string().optional(),
      scheduler: z.string().optional(),
      upscale_quality: z.enum(["fast", "balanced", "high"]).optional(),
      face_detail: z.boolean().optional(),
    },
    (input, signal) => {
      // A chat that sends the same generate again within two minutes (a retry after a transport error, a doubled tool call) gets the first call's
      // jobs and reply, so one request is one set of images; asking again later, or for anything different, queues anew.
      const now = Date.now();
      for (const [key, entry] of recentGenerates)
        if (now - entry.at > generateDedupeMs) recentGenerates.delete(key);
      const key = `${refs || owner}\n${stableJson(input)}`;
      const earlier = generateDedupeMs > 0 ? recentGenerates.get(key) : null;
      if (earlier) return earlier.reply;
      const reply = generateOnce(input, signal);
      recentGenerates.set(key, { at: now, reply });
      reply.catch(() => {
        if (recentGenerates.get(key)?.reply === reply) recentGenerates.delete(key);
      });
      return reply;
    },
  );
  /** The account's character by id or name, with the images it still has, owned for this call. */
  const characterFor = async (value, signal, views = false) => {
    const { characters = [] } = await media.request("GET", "/api/characters", undefined, owner, {
      signal,
    });
    const wanted = value.trim().toLowerCase();
    const card =
      characters.find((item) => item.id === value.trim()) ||
      characters.find((item) => item.name.toLowerCase() === wanted);
    if (!card) throw new Error(`No character "${value}". Call models to list them.`);
    const referenceIds = card.references.map((asset) => asset.id);
    if (!referenceIds.length && !views)
      throw new Error(`${card.name} has no images left. Ask the user to add some in Studio.`);
    media.adopt(owner, refs, { assets: referenceIds });
    return { ...card, referenceIds };
  };
  const generateOnce = async (input, signal) => {
    const {
      kind,
      tier: wanted,
      aspect,
      request,
      preview,
      profile_ids,
      each_profile,
      title,
      ...args
    } = structuredClone(input);
    if (args.reference_asset_ids)
      args.reference_asset_ids = args.reference_asset_ids.map((id) => media.referenceId(id));
    const views = args.character_views === true;
    delete args.character_views;
    if (views && !args.character)
      throw new Error("character_views needs character: the name or id of the card.");
    const card = args.character ? await characterFor(args.character, signal, views) : null;
    delete args.character;
    // The views share one seed and, where the profile edits with references, the card's first
    // image, which each plan's prompts then follow (characterShots).
    if (views)
      Object.assign(args, {
        prompts: characterShots(card.description, false),
        count: 1,
        seed: args.seed ?? crypto.randomInt(2 ** 31),
        same_seed: true,
      });
    if (!args.prompts)
      throw new Error(
        "Write the finished prompts yourself, following the model's prompting guide, and pass them as prompts (with the user's words as request), then call generate again.",
      );
    if ([args.profile_id, profile_ids, each_profile].filter(Boolean).length > 1)
      throw new Error(
        "Pass one of profile_id (one model), profile_ids (several) or each_profile (every model of kind and tier), then call generate again.",
      );
    const several = Boolean(profile_ids || each_profile);
    if (several && views)
      throw new Error("character_views queues on one model: pass profile_id or leave it out.");
    if (several && args.loras?.length)
      throw new Error(
        "LoRAs belong to one model: pass them with profile_id, or leave loras out for several models.",
      );
    // Instructions sent as an exact prompt would run literally, and their number of images would be lost.
    for (const prompt of args.prompts) {
      const instructed = exactPromptInstructions(prompt);
      if (instructed) throw new Error(instructed);
    }
    // "count: 4" beside four prompts means one image each, not sixteen.
    if (
      args.count > 1 &&
      args.count === args.prompts?.length &&
      args.count * args.prompts.length > maxJobsPerCall
    )
      args.count = 1;
    const count = args.count ?? 1;
    // Checked before any prompt is written, so an oversized call costs nothing and says how to split.
    assertJobCount(args.prompts?.length || 1, count);
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
      targets = [
        args.profile_id === undefined
          ? fits
            ? fromRequest
            : picked(
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
      for (const pool of [ranked.filter((profile) => profile.keepsCharacters), ranked]) {
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
    // The model a warning names when the chosen one can't hold a character's (or reference's) face.
    const keeper =
      (card?.referenceIds.length || named.length) && !views
        ? characterProfiles(localUnlessAsked(await media.profiles("image", owner), { request }))[0]
        : undefined;
    targets = targets.filter(
      (target, index) =>
        targets.findIndex((other) => other.profile.id === target.profile.id) === index,
    );
    const jobs = targets.length * (args.prompts?.length || 1) * count;
    if (jobs > maxJobsPerCall)
      throw new Error(
        `${targets.length} models × ${jobs / targets.length} images each would queue ${jobs}; one call queues at most ${maxJobsPerCall}. Lower count, pass fewer profile_ids, or name a tier.`,
      );
    // A preview's prompts run as shown when the same call follows without preview.
    const previewKey = `${refs || owner}\n${stableJson({ ...input, preview: undefined })}`;
    const previewed = previews.get(previewKey);
    if (!preview) previews.delete(previewKey);
    const plans =
      !preview && previewed && Date.now() - previewed.at < previewMs
        ? previewed.plans
        : await Promise.all(
            targets.map(async ({ profile, note }) => {
              const sized = mcpSize(profile, { aspect });
              if (sized && (args.width !== undefined || args.height !== undefined))
                throw new Error("Pass aspect or width and height, not both.");
              // A character sends its first image (characterImages), only to a model that edits
              // with it: as an img2img start image its pose and layout (a whole sheet) carry over.
              const room = editsReferences(profile)
                ? Math.min(Math.max(0, referenceCount(profile).max - named.length), characterImages)
                : 0;
              const plan = {
                ...args,
                ...sized,
                ...(card
                  ? { reference_asset_ids: [...named, ...card.referenceIds.slice(0, room)] }
                  : {}),
                // Its lead starts each prompt verbatim, as in the composer.
                ...(card
                  ? {
                      prompts: views
                        ? characterShots(card.description, room > 0)
                        : args.prompts.map((prompt) =>
                            withCharacter(prompt, card.description, room > 0),
                          ),
                    }
                  : {}),
                profile_id: profile.id,
                ...(profile.namedBackend ? { profile_backend: profile.namedBackend } : {}),
              };
              const start =
                card?.referenceIds.length && !views && !room
                  ? `${profile.label || profile.id} can't take ${card.name}'s image as a reference, so only the description carries the character and the face will change from image to image. Tell the user; ${keeper ? `${keeper.label || keeper.id}` : "a model that edits with references"} keeps the same face in new outfits and scenes. `
                  : "";
              // A reference on an img2img model is its start image, and the reply says what follows.
              const img2img =
                named.length && profile.mediaInputs?.length && !editsReferences(profile)
                  ? `${profile.label || profile.id} starts from the reference image (img2img): its pose and layout carry over and a face drifts in new scenes. Tell the user; ${keeper ? `${keeper.label || keeper.id}` : "a model that edits with references"} keeps the same person in new outfits and scenes. `
                  : "";
              const alone =
                views && card.referenceIds.length && !room
                  ? `The views come from ${card.name}'s description alone: this model doesn't edit with references. `
                  : "";
              return {
                profile,
                note: `${note || ""}${start}${img2img}${alone}`,
                plan,
                source: "exact",
              };
            }),
          );
    if (preview) {
      if (previews.size >= 256) previews.delete(previews.keys().next().value);
      previews.set(previewKey, { at: Date.now(), plans });
      const lines = plans.map(
        ({ profile, plan }) =>
          `${profile.label || profile.id}: ${[...new Set(plan.prompts)].map(shortPrompt).join(" | ")}`,
      );
      return {
        content: [
          {
            type: "text",
            text: `Preview only; nothing is queued. Show the user these prompts and wait. To queue exactly these prompts, call generate again with the same arguments without preview; for changes, call it with revised prompts.\n\n${lines.join("\n")}`,
          },
        ],
      };
    }
    // A call of several results is one titled set; the gallery titles each prompt's results by
    // titles, or by its prompt where they are missing.
    const resultSet = jobs > 1 && {
      id: crypto.randomUUID(),
      title: title || replyTitle(request) || promptWords(args.prompts[0]),
      source: actor.session ? "Chat" : actor.client || "MCP",
    };
    for (const item of plans) if (resultSet) item.plan.result_set = resultSet;
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
    if (several) {
      // One set per model, queued in order so each model loads once; links come back at once.
      // Every set shares one seed, so image N of each model is a like-for-like comparison.
      const seed = args.seed ?? crypto.randomInt(2 ** 31);
      const sets = [];
      for (const item of plans)
        sets.push({
          profile: item.profile,
          note: item.note,
          queued: (
            await submit(item.profile, { ...item.plan, seed }, recordOf(item), {
              guide: false,
            })
          ).queued,
        });
      return respondSets(sets, "", signal, await comparisonOf(sets));
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
    let viewsNote = "";
    if (views) {
      await media.request(
        "POST",
        `/api/characters/${encodeURIComponent(card.id)}/generated`,
        { jobIds: submission.queued.jobs.map((job) => job.job_id) },
        owner,
        { signal },
      );
      viewsNote = `Studio wrote one prompt per view for ${card.name}; once they finish, the user picks which to keep on the card in Studio. `;
    }
    return respond(
      submission.queued,
      profile,
      signal,
      submission.guide,
      source,
      `${tierNote || ""}${faceNote}${viewsNote}`,
    );
  };
  tool(
    server,
    "reuse",
    "reuse result",
    `Follow up on one finished result. mode again (default) reruns it with a new seed: prompt is your revised prompt, run as written; preserve_seed keeps its seed. mode animate makes an image a video, extend continues a video from its last frame; prompt is the motion, or pass theme; length is seconds. tier or profile_id picks the model. runs_on, only if asked, keeps animate or extend local or cloud. mode reference returns it as a reference_asset_id for generate. mode upscale enlarges it in place, only when asked (upscale_quality, balanced by default).`,
    {
      ...output,
      job_id: z
        .string()
        .min(1)
        .max(200)
        .describe('Its ref as the reply shows it ("result 1"), or a job_id; never "all".'),
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
      upscale_quality: z.enum(["fast", "balanced", "high"]).optional(),
    },
    async (
      {
        job_id,
        output_index,
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
      const id = resolve(job_id);
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
        if (wanted || prompt || request || profile_id || preserve_seed || theme || count > 1)
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
      if (mode === "reference") {
        if (wanted || prompt || request || profile_id || preserve_seed || count > 1)
          throw new Error(
            "mode reference takes only job_id and output_index. To generate from this result, call reuse with mode again or animate.",
          );
        const result = await media.download(owner, id, output_index);
        if (!imageMimes.includes(result.mime))
          throw new Error("Only images can be reused as references.");
        return mcpJson(
          await media.upload(
            owner,
            result.content.toString("base64"),
            `reference.${result.mime.split("/")[1]}`,
          ),
        );
      }
      // Studio never rewrites a prompt: the chat writes the change into it; request is the user's words.
      if (request && !prompt && !theme)
        throw new Error(
          "Studio runs prompts exactly as given. Write the revised prompt yourself from the result's prompt and pass it as prompt (for animate, the motion), with the user's words as request, or leave request out to run the prompt unchanged. Call reuse again.",
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
      // A plain run again keeps the result's prompt, so it keeps how that prompt was written (Recreate does the same).
      const carried = !prompt && !moved ? item.assistant || recorded?.assistant : null;
      const submission = await submit(plan.profile, plan.args, {
        ...((request || !prompt) && (request || recorded?.request)
          ? { request: request || recorded.request }
          : {}),
        ...(carried ? { assistant: carried } : {}),
        parent: id,
      });
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
  return { namedInTier };
}
