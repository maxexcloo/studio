// A chat's project (domain/projects.ts): the project tool, and how generate keeps to its brief and constraints.
import { z } from "zod";

import { briefSummary } from "../../shared/projects.ts";
import { resolutionSize, snapDimension } from "../../shared/resolution.ts";
import { recordBelongsToAccount } from "../account-ownership.js";
import { directRoute } from "../domain/direct-route.ts";
import {
  explicitExclusions,
  forbiddenMotifs,
  mentionsMotif,
  phraseWords,
} from "../domain/dream-concepts.ts";
import { readRuntimeDocument, writeRuntimeDocument } from "../persistence/runtime.ts";
import { maxJobsPerCall } from "./controls.js";
import { mcpJson } from "./media.js";
import { localUnlessAsked, mcpTiers, profilesForTier } from "./tiers.js";

const tierWords = {
  "super fast": "turbo",
  ...Object.fromEntries(mcpTiers.map((t) => [t, t])),
};
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const maxChats = 500;
const keptReferencesMs = 30 * 60_000;

/**
 * Each conversation's own choices, which a summarised chat forgets: LoRAs off, the model or tier
 * per kind, count and set name. Read and written through the runtime store on each call, so every
 * replica sees them.
 */
export function createChatChoices({ dataDir, now = Date.now }) {
  const key = (owner, chat) => `${owner || ""}\n${chat}`;
  const all = () => readRuntimeDocument(dataDir, "mcp-chat-choices") ?? {};
  return {
    read: (owner, chat) => (chat ? all()[key(owner, chat)] || {} : {}),
    /** Remembers what a generate call chose; `profileId` is the one model it resolved to, if named. */
    remember(owner, chat, input, profileId) {
      if (!chat) return;
      const saved = all();
      const choices = { ...saved[key(owner, chat)] };
      if (Array.isArray(input.loras)) {
        if (input.loras.length) delete choices.loras;
        else choices.loras = false;
      }
      const kind = input.kind || "image";
      if (profileId) choices[kind] = { profile_id: profileId };
      else if (input.tier) choices[kind] = { tier: input.tier };
      if (input.count) choices.count = input.count;
      if (input.title) choices.title = input.title;
      delete saved[key(owner, chat)];
      saved[key(owner, chat)] = { ...choices, at: now() };
      const keys = Object.keys(saved);
      for (const old of keys.slice(0, Math.max(0, keys.length - maxChats))) delete saved[old];
      writeRuntimeDocument(dataDir, "mcp-chat-choices", saved);
    },
    /**
     * Remembers the references a generate call named (attached images arrive on their own turn
     * only), or forgets them for an empty list.
     */
    rememberReferences(owner, chat, ids) {
      if (!chat) return;
      const saved = all();
      const choices = { ...saved[key(owner, chat)] };
      if (ids.length) choices.references = { ids, at: now() };
      else delete choices.references;
      saved[key(owner, chat)] = { ...choices, at: now() };
      writeRuntimeDocument(dataDir, "mcp-chat-choices", saved);
    },
    /** The account's chats with something remembered, newest first, for Taste › Chat Notes. */
    list(account, at = now()) {
      return Object.entries(all())
        .flatMap(([stored, { references, image, video, loras, count, title, at: used }]) => {
          const [owner, chat] = stored.split("\n");
          if (!recordBelongsToAccount({ ownerId: owner }, account)) return [];
          const kept = references && at - references.at < keptReferencesMs;
          const shown = {
            ...(image ? { image } : {}),
            ...(video ? { video } : {}),
            ...(loras === false ? { loras } : {}),
            ...(count > 1 ? { count } : {}),
            ...(title ? { title } : {}),
            ...(kept
              ? {
                  references: {
                    count: references.ids.length,
                    until: new Date(references.at + keptReferencesMs).toISOString(),
                  },
                }
              : {}),
          };
          return Object.keys(shown).length
            ? [{ chat, ...shown, at: new Date(used).toISOString() }]
            : [];
        })
        .sort((a, b) => b.at.localeCompare(a.at));
    },
    /** Forgets what the account's chat remembered. */
    forget(account, chat) {
      const saved = all();
      for (const stored of Object.keys(saved)) {
        const [owner, named] = stored.split("\n");
        if (named === chat && recordBelongsToAccount({ ownerId: owner }, account))
          delete saved[stored];
      }
      writeRuntimeDocument(dataDir, "mcp-chat-choices", saved);
    },
  };
}

/** Taste › Chat Notes' list of what each chat remembers, and Clear. */
export function registerChatChoiceRoutes(app, { dataDir }) {
  const choices = createChatChoices({ dataDir });
  directRoute(app, "GET", "/api/chat-choices", (account) => ({
    status: 200,
    payload: { chats: choices.list(account) },
  }));
  directRoute(app, "DELETE", "/api/chat-choices/:chat", (account, { params }) => {
    choices.forget(account, params.chat);
    return { status: 200, payload: { chats: choices.list(account) } };
  });
}

/**
 * A generate call with the chat's earlier choices filled in where it left them out (the model is
 * generate's, as a model named in the request wins), and what it kept.
 */
export function keptChoices(choices, input, at = Date.now()) {
  const next = { ...input };
  const kept = [];
  // A follow-up ("go" after a preview) keeps the chat's recent references unless it names its own.
  const references = choices.references;
  if (
    input.reference_asset_ids === undefined &&
    !input.character &&
    references?.ids.length &&
    at - references.at < keptReferencesMs
  ) {
    next.reference_asset_ids = references.ids;
    kept.push(
      `references ${references.ids.join(", ")} (pass reference_asset_ids: [] to leave them out)`,
    );
  }
  if (input.title === undefined && choices.title) next.title = choices.title;
  if (input.loras === undefined && choices.loras === false) {
    next.loras = [];
    kept.push("no LoRAs");
  }
  const several = input.profile_ids || input.each_profile;
  const tier = choices[input.kind || "image"]?.tier;
  if (!input.tier && input.profile_id === undefined && !several && tier) {
    next.tier = tier;
    kept.push(tier);
  }
  const prompts = Array.isArray(input.prompts) ? input.prompts.length : 0;
  if (!input.count && choices.count > 1 && prompts && prompts * choices.count <= maxJobsPerCall) {
    next.count = choices.count;
    kept.push(`${choices.count} each`);
  }
  return { args: next, kept };
}

/** The brief as one line for generate's reply, so the chat keeps writing to it; "" without one. */
export function briefLine({ name, brief }) {
  const summary = [
    briefSummary(brief),
    brief.loras?.length && `LoRAs ${brief.loras.join(", ")}`,
    brief.avoid && `avoid ${brief.avoid}`,
  ]
    .filter(Boolean)
    .join("; ");
  return summary ? `Project ${name}: ${summary}. Keep prompts to it. ` : "";
}

/**
 * A generate call's arguments under the project's constraints, and what changed: LoRAs off runs
 * none, and its aspect and resolution replace the call's own size.
 */
export function projectArgs({ name, constraints }, args) {
  const next = { ...args };
  const notes = [];
  if (!constraints.loras) {
    if (args.loras?.length) notes.push(`LoRAs are off in ${name}, so none ran.`);
    next.loras = [];
  }
  if (constraints.aspect) {
    if (args.aspect && args.aspect !== constraints.aspect)
      notes.push(`${name} is ${constraints.aspect}, so it ran ${constraints.aspect}.`);
    next.aspect = constraints.aspect;
  }
  if (constraints.resolution) {
    if (args.resolution && args.resolution !== constraints.resolution)
      notes.push(`${name} is ${constraints.resolution}, so it ran ${constraints.resolution}.`);
    next.resolution = constraints.resolution;
  }
  return { args: next, note: notes.map((note) => `${note} `).join("") };
}

/**
 * Refuses prompts that name something the brief avoids, before any queues: an image model draws
 * what a prompt names, even after "no".
 */
export function assertAvoided({ name, brief }, prompts) {
  const terms = brief.avoid
    .split(/[,;\n]+/)
    .map((term) => term.trim().replace(/^(?:no|without)\s+/i, ""))
    .filter(Boolean)
    .map((term) => ({
      term,
      exact: new RegExp(`(?<![\\p{L}\\p{N}])${escape(term)}(?![\\p{L}\\p{N}])`, "iu"),
      motifs: forbiddenMotifs([term], []),
    }));
  for (const [index, prompt] of prompts.entries())
    for (const { term, exact, motifs } of terms)
      if (exact.test(prompt) || motifs.some((motif) => mentionsMotif(prompt, motif)))
        throw new Error(
          `Prompt ${index + 1} names "${term}", which ${name} avoids; models draw what a prompt names, even after "no". Leave it out and call generate again; never remove an avoid to get past this.`,
        );
}

/**
 * The chosen models under the project's: where it lists profiles of the targets' kind, only those
 * run, the first ready one that takes the references (in the wanted tier first) standing in.
 * `known` is every profile the account has, ready or not, to read each listed one's kind.
 */
export function projectTargets({ name, constraints }, targets, known, { references = 0 } = {}) {
  const kind = targets[0]?.profile.kind;
  const listed = constraints.profiles
    .map((id) => known.find((profile) => profile.id === id))
    .filter((profile) => profile?.kind === kind);
  if (!listed.length) return { targets, note: "" };
  const allowed = new Set(listed.map((profile) => profile.id));
  const kept = targets.filter(({ profile }) => allowed.has(profile.id));
  if (kept.length === targets.length) return { targets, note: "" };
  const label = (profile) => profile.label || profile.id;
  const others = targets
    .filter(({ profile }) => !allowed.has(profile.id))
    .map(({ profile }) => label(profile));
  if (kept.length)
    return {
      targets: kept,
      note: `${name} runs only on ${listed.map(label).join(", ")}, so ${others.join(", ")} didn't. `,
    };
  const fits = (profile) => (profile.mediaInputs || []).length >= references;
  const pick = listed.find(fits) || listed[0];
  return {
    targets: [{ profile: pick, note: "" }],
    note: `${name} runs only on ${listed.map(label).join(", ")}, so ${label(pick)} ran instead of ${others.join(", ")}. `,
  };
}

function matchesAspect(aspect, { width, height }, profile) {
  if (!(width > 0 && height > 0)) return false;
  if (aspect === "portrait") return height > width;
  if (aspect === "landscape") return width > height;
  if (aspect === "square") return width === height;
  const [across, down] = aspect.split(":").map(Number);
  const widthStep = profile.constraints?.width?.step || 16;
  const heightStep = profile.constraints?.height?.step || 16;
  // A named ratio can land between points on the model's dimension grid.
  return Math.abs(width * down - height * across) <= (widthStep * down + heightStep * across) / 2;
}

/** An exact follow-up keeps its selected settings or is refused before admission. */
export function assertProjectReuse(project, profile, input, known) {
  const { name, constraints } = project;
  const refuse = (setting) => {
    throw new Error(
      `${setting} conflicts with ${name}'s current constraints. Call generate to follow them, or change the project before reusing this result.`,
    );
  };
  const { targets } = projectTargets(project, [{ profile }], known);
  if (targets[0].profile.id !== profile.id) refuse(profile.label || profile.id);
  if (!constraints.loras && input.loras.length) refuse("This LoRA stack");
  if (constraints.aspect && !matchesAspect(constraints.aspect, input, profile))
    refuse(`This run's ${input.width}×${input.height} aspect`);
  if (constraints.resolution) {
    const { width, height } = input;
    const dimension = width >= height ? "width" : "height";
    const { step } = profile.constraints?.[dimension] ?? {};
    const target = resolutionSize({ width: 1, height: 1 }, constraints.resolution).width;
    const matches =
      profile.options?.resolutions?.length && input.resolution
        ? String(input.resolution).toUpperCase() === constraints.resolution
        : Math.max(width, height) === snapDimension(target, { step });
    if (!matches) refuse(`This run's ${input.resolution || `${width}×${height}`} size`);
  }
}

/** The only Dream Taste constraint on generation submitted through MCP. */
export async function accountExclusions(media, owner, signal) {
  const taste = await media
    .request("GET", "/api/taste", undefined, owner, { signal })
    .catch(() => null);
  return taste?.preferences?.exclusions || [];
}

const exclusionLead = new Set([
  "a",
  "an",
  "any",
  "avoid",
  "never",
  "no",
  "not",
  "some",
  "the",
  "without",
]);
const danglingLink = new Set(["and", "holding", "of", "or", "with"]);
const wordsIn = (text) => [...text.matchAll(/[\p{L}\p{N}]+/gu)];
const contentWords = (text) =>
  wordsIn(text).filter(([word]) => !exclusionLead.has(word.toLowerCase())).length;

/** The shortest run of up to five words in `text` that names `motif`: [start, end, its words]. */
function motifSpan(text, motif) {
  const words = wordsIn(text);
  for (let size = 1; size <= 5; size++)
    for (let first = 0; first + size <= words.length; first++) {
      const start = words[first].index;
      const last = words[first + size - 1];
      const end = last.index + last[0].length;
      if (mentionsMotif(text.slice(start, end), motif)) {
        // A leading "no" or article goes with it, as does a link left dangling before a break.
        const word = (index) => words[index][0].toLowerCase();
        const spaced = (index) =>
          /^\s+$/.test(
            text.slice(words[index - 1].index + words[index - 1][0].length, words[index].index),
          );
        let at = first;
        while (at > 0 && exclusionLead.has(word(at - 1)) && spaced(at)) at--;
        if (
          at > 0 &&
          danglingLink.has(word(at - 1)) &&
          spaced(at) &&
          /^\s*(?:[,.;:!?)]|$)/.test(text.slice(end))
        )
          at--;
        return [words[at].index, end, text.slice(start, end)];
      }
    }
  return null;
}

const tidied = (text) =>
  text
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/[ \t]+([,.;:!?)])/g, "$1")
    .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
    .replace(/[,;:]+(?=[.!?])/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/(^|\n)[\s,;:.-]+/g, "$1")
    .replace(/[\s,;:-]+$/, "")
    .trim();

/**
 * Prompts without what the account's Taste exclusions name (an image model draws what a prompt
 * names, even after "no"): each named phrase goes, with its "no" or article, and the reply says
 * what went. A prompt that would keep fewer than two words is refused, since what would remain
 * is no longer the request. `excluded` maps each changed prompt to the words removed from it.
 */
export function withoutTasteExclusions(exclusions, prompts) {
  const explicit = exclusions.map((entry) => [entry, explicitExclusions([entry])]);
  const excluded = {};
  const removed = [];
  const cleaned = prompts.map((prompt, index) => {
    if (!prompt) return prompt;
    let next = prompt;
    const words = [];
    for (const [entry, motifs] of explicit)
      for (const motif of motifs)
        for (let span = motifSpan(next, motif); span; span = motifSpan(next, motif)) {
          const [start, end, named] = span;
          next = `${next.slice(0, start)}${next.slice(end)}`;
          words.push(named);
          removed.push({ index, named, entry });
        }
    if (!words.length) return prompt;
    next = tidied(next);
    if (contentWords(next) < 2)
      throw new Error(
        `Prompt ${index + 1} is little more than ${words.map((word) => `"${word}"`).join(", ")}, which your Taste Profile excludes. Tell the user; they can edit exclusions in Settings › Taste.`,
      );
    excluded[next] = [...new Set([...(excluded[next] || []), ...words])];
    return next;
  });
  const note = removed.length
    ? `Removed for the user's Taste exclusions: ${removed
        .map(
          ({ index, named, entry }) =>
            `"${named}"${prompts.length > 1 ? ` from prompt ${index + 1}` : ""}${phraseWords(named) === phraseWords(entry) ? "" : ` (${entry})`}`,
        )
        .join(", ")}. Tell the user. `
    : "";
  return { prompts: cleaned, excluded, note };
}

/** Registers project: a chat attaches to one so generate keeps to its brief and constraints. */
export function registerProjectTool({ tool, server, media, owner, chat, namedInTier }) {
  const api = (method, route, body, signal) =>
    media.request(method, route, body, owner, { signal });
  const need = () => {
    if (!chat) throw new Error("This chat sends no conversation id, so it can't hold a project.");
    return chat;
  };
  /** Profile ids from names, ids or a tier ("turbo" lists every turbo profile). */
  const profileIds = async (values) => {
    const all = await media.profiles("all", owner);
    return [
      ...new Set(
        values.flatMap((value) => {
          const tier = tierWords[value.trim().toLowerCase()];
          return tier
            ? profilesForTier(localUnlessAsked(all), tier).map((profile) => profile.id)
            : [namedInTier(all, value).profile.id];
        }),
      ),
    ];
  };
  const shown = async (project) => {
    if (!project) return null;
    const all = await media.profiles("all", owner).catch(() => []);
    const label = (id) => all.find((profile) => profile.id === id)?.label || id;
    const { id, name, brief, constraints, paused } = project;
    return {
      id,
      name,
      enabled: !paused,
      brief,
      constraints: {
        ...constraints,
        profiles: constraints.profiles.map(label),
      },
    };
  };
  tool(
    server,
    "project",
    "project",
    `The chat's project and constraints. show lists projects; attach (project), create, update (only changes) or detach.`,
    {
      action: z.enum(["show", "attach", "create", "update", "detach"]).optional(),
      project: z.string().optional(),
      name: z.string().optional(),
      subjects: z.string().optional(),
      ethnicity: z.string().optional(),
      age: z.string().optional(),
      body: z.string().optional(),
      styles: z.string().optional(),
      rules: z.string().optional().describe("Banned changes and standing rules."),
      avoid: z.string().optional(),
      profiles: z.array(z.string()).optional().describe('ids, names or a tier ("turbo"); [] any'),
      loras: z.boolean().optional(),
      lora_names: z.array(z.string()).optional(),
      aspect: z.string().optional(),
      resolution: z.string().optional(),
    },
    async (
      {
        action = "show",
        project,
        name,
        profiles,
        loras,
        aspect,
        resolution,
        ethnicity,
        age,
        body: bodyType,
        lora_names,
        ...brief
      },
      signal,
    ) => {
      Object.assign(
        brief,
        Object.fromEntries(
          Object.entries({ ethnicity, age, body: bodyType, loras: lora_names }).filter(
            ([, value]) => value !== undefined,
          ),
        ),
      );
      const attach = async (projectId) =>
        (await api("POST", "/api/dream/projects/attach", { chat: need(), projectId }, signal))
          .project;
      if (action === "detach") {
        await attach(null);
        return mcpJson({ project: null });
      }
      if (action === "attach") {
        if (!project) throw new Error("Pass project: its name or id.");
        const { projects } = await api("GET", "/api/dream/projects", undefined, signal);
        const wanted = project.toLowerCase();
        const found =
          projects.find((entry) => entry.id === project) ||
          projects.find((entry) => entry.name.toLowerCase() === wanted);
        if (!found)
          throw new Error(
            `No project "${project}". Projects: ${projects.map((entry) => entry.name).join(", ") || "none"}.`,
          );
        return mcpJson({ project: await shown(await attach(found.id)) });
      }
      const current = (await api("POST", "/api/dream/projects/activity", { chat: need() }, signal))
        .project;
      if (action === "show") {
        const { projects } = await api("GET", "/api/dream/projects", undefined, signal);
        return mcpJson({
          project: await shown(current),
          projects: projects.map(({ name }) => name),
        });
      }
      const constraints = Object.fromEntries(
        Object.entries({
          profiles: profiles && (await profileIds(profiles)),
          loras,
          aspect,
          resolution,
        }).filter(([, value]) => value !== undefined),
      );
      const body = {
        ...(name ? { name } : {}),
        ...(Object.keys(brief).length ? { brief } : {}),
        ...(Object.keys(constraints).length ? { constraints } : {}),
      };
      if (action === "create") {
        if (!name) throw new Error("Pass name for the new project.");
        const created = (await api("POST", "/api/dream/projects", body, signal)).project;
        return mcpJson({ project: await shown(await attach(created.id)) });
      }
      if (!current) throw new Error("This chat has no project: attach or create one first.");
      if (!Object.keys(body).length) throw new Error("Pass what the user changed.");
      const updated = (
        await api(
          "PUT",
          `/api/dream/projects/${encodeURIComponent(current.id)}?by=chat`,
          body,
          signal,
        )
      ).project;
      return mcpJson({
        project: await shown(updated),
        note: "Tell the user what changed; they can undo it on Studio's Dream page.",
      });
    },
  );
}
