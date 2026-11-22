import { z } from "zod";

import { cardKinds, suggestedCards } from "../../shared/characters.ts";
import { isCloudProfile, runBackend } from "../../shared/profiles.ts";
import { accessFeatures } from "../account-policy.js";
import { profileAspectSize } from "../generation-defaults.js";
import {
  clip,
  closest,
  listedControls,
  loraIndex,
  loraQueryWords,
  maxJobsPerCall,
  mcpLoras,
} from "./controls.js";
import { mcpJson } from "./media.js";
import { compactGuide } from "./prompting.js";
import {
  familyMatches,
  fastestFirst,
  findProfile,
  localUnlessAsked,
  mcpTiers,
  nameWords,
  profilesNearTier,
  searchProfiles,
  serviceState,
  speedWordList,
  tierOf,
  waitingServices,
  withinFamily,
  workerState,
} from "./tiers.js";

// The models tool shows a guide's gist; generate sends the whole guide for the chat to write to.
const maxShownGuideCharacters = 500;
const maxListedLoras = 30;

// A free string checked here, so a call with a tier this deployment doesn't have gets the current list.
export const tier = z
  .string()
  .trim()
  .toLowerCase()
  .refine((value) => mcpTiers.includes(value), {
    message: `Use one of ${mcpTiers.join(", ")}`,
  })
  .describe(`One of ${mcpTiers.join(", ")}; turbo is Super Fast.`);

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

/** Exact profile IDs stay fixed. A family name can resolve to an explicitly requested tier. */
export const namedInTier = (profiles, value, wanted) => {
  // A cloud (Grok) profile only by its exact id or when the name asks for the cloud.
  const found = profileNamed(
    profiles.some((profile) => profile.id === value)
      ? profiles
      : localUnlessAsked(profiles, { name: value }),
    value,
  );
  return found.id === value ? { profile: found, note: "" } : withinFamily(profiles, found, wanted);
};

/**
 * How many references a profile takes, from its graph's media inputs, and per backend where a
 * combined profile's backends differ; its label or description may say otherwise.
 */
export const referenceCount = (profile) => {
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
    note: "From the profile's graph; outranks its label.",
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

export function registerModelTool({ tool, server, media, owner, review }) {
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
  tool(
    server,
    "models",
    "find models",
    "What Studio has now. Without profile_id: ready profiles by kind (Stopped or Offline marked), those needing setup, service states, the account's features and characters (generate's character adds its looks: prompts set only outfit and scene; shots: Studio writes each; character_sheet its sheet). profile_id or profile_ids (id, label or words): guide gist, defaults, controls, references and LoRAs. lora_query or lora_names look up LoRAs, in every profile without profile_id; lora_page pages.",
    {
      kind: z.enum(["all", "image", "video"]).default("all"),
      tier: tier.optional(),
      profile_id: z.string().optional(),
      profile_ids: z.array(z.string().min(1)).min(1).max(maxJobsPerCall).optional(),
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
      profile_ids,
      lora_query,
      lora_names = [],
      lora_page,
      full_guide,
    }) => {
      const all = await media.profiles(kind, owner);
      if (named_id === undefined && !profile_ids) {
        let profiles = all;
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
        // Cards are an extra here: a failed listing leaves them out rather than the models.
        const cards = async (cardKind) =>
          !access || access.features.characters
            ? suggestedCards(
                (
                  await media.request("GET", `/api/${cardKind}`, undefined, owner).catch(() => ({}))
                )[cardKind] ?? [],
              )
            : [];
        const [characters, outfits, scenes] = await Promise.all(Object.keys(cardKinds).map(cards));
        // Each card's gist: generate reads the whole description by name.
        const cardList = (items) =>
          items.map(({ id, name, description, rating }) => ({
            id,
            name,
            description: clip(description, 120),
            ...(rating && { rating }),
          }));
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
                  description: clip(card.description, 120),
                  ...(card.rating && { rating: card.rating }),
                  images: card.references.length,
                  ...(card.sheet ? { sheet: card.sheet.status } : {}),
                })),
              }
            : {}),
          ...(outfits.length ? { outfits: cardList(outfits) } : {}),
          ...(scenes.length ? { scenes: cardList(scenes) } : {}),
        });
      }
      /** One profile's guide gist, defaults, controls and LoRAs, or the profiles its words name. */
      const describe = async (profile_id) => {
        let profiles = all;
        if (!profiles.some((profile) => profile.id === profile_id))
          profiles = localUnlessAsked(profiles, { name: profile_id });
        // Words that name several models ("klein", "flux") list them instead of choosing one.
        const named = findProfile(profiles, profile_id);
        const matches = named
          ? []
          : searchProfiles(wanted ? profilesNearTier(profiles, wanted) : profiles, profile_id);
        if (matches.length > 1) return listed(matches);
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
            return { id: profile.id, ...(await noLoras({ profile })) };
          if (!loraQueryWords(lora_query).length && !lora_names.length)
            return {
              id: profile.id,
              ...(await lorasPage(
                loraIndex(profile, infos, ratings).map(({ line }) => line),
                lora_page,
                profile.options.loras.length,
              )),
            };
          const { loras, total, more, missing } = mcpLoras(profile, infos, {
            query: lora_query,
            names: lora_names,
            ratings,
          });
          return {
            id: profile.id,
            loras,
            loras_total: total,
            ...(more ? { more_matches: more } : {}),
            ...(missing ? { missing } : {}),
            ...(loras.length ? {} : { loras_note: await noMatch(lora_query, total) }),
          };
        }
        // Only the whole guide counts as read; generate still sends it after the gist.
        if (full_guide) review(profile.id);
        // Defaults only for adjustable controls: a fixed value is not something to choose.
        const defaults = Object.fromEntries(
          Object.entries({ ...profile.defaults, count: controls.count.default }).filter(
            ([key]) => controls[key] || ["frames", "fps", "duration"].includes(key),
          ),
        );
        // The size a run without aspect draws: the family's default preset, else the profile's own.
        const size = profileAspectSize(profile);
        if (controls.aspect && size?.width && size?.height)
          defaults.size = `${size.width}×${size.height}`;
        // The backend a run with LoRAs uses, which may not be the default (runBackend).
        const loraBackend =
          controls.loras && profile.backend
            ? profile.backendOptions.find(
                (option) =>
                  option.id ===
                  runBackend(profile.backendOptions, profile.backend, "", false, true),
              )
            : null;
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
        const { total } = mcpLoras(profile, infos, { ratings });
        const guide = full_guide
          ? profile.prompting
          : compactGuide(profile.prompting, maxShownGuideCharacters);
        const detail = {
          ...Object.fromEntries(
            ["id", "label", "kind", "family", "description", "aspectPolicy", "native"]
              .filter((key) => key in profile)
              .map((key) => [key, profile[key]]),
          ),
          tier: tierOf(profile),
          references: referenceCount(profile),
          ...(workerState[profile.availability]
            ? { state: workerState[profile.availability] }
            : {}),
          // A combined profile: the backend it runs on and the others it has.
          ...(profile.backend
            ? {
                backend: profile.backend,
                backends: profile.backendOptions.map((option) => option.label),
                ...(loraBackend
                  ? {
                      lora_backend: `${loraBackend.label}${loraBackend.ready === false ? " (not ready)" : ""}`,
                    }
                  : {}),
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
                loras_total: total,
                loras_note: `Only when the user asks for a LoRA: find it with lora_query, then pass its name to generate.${profile.capabilities?.defaultLoras === false ? " This model does best without LoRAs: add one only when the user names it." : ""}`,
              }
            : {}),
          ...(guide ? { prompting: guide } : {}),
        };
        return detail;
      };
      // Several models answer in one call, so a chat comparing models takes one narrow step.
      if (profile_ids) return mcpJson({ profiles: await Promise.all(profile_ids.map(describe)) });
      return mcpJson(await describe(named_id));
    },
    { readOnlyHint: true },
  );
}
