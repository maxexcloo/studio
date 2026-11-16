// A chat's project (domain/projects.ts): the project tool, and how generate keeps to its brief and constraints.
import { z } from "zod";

import { briefSummary } from "../../shared/chat-brief.ts";
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
  };
}

/**
 * A generate call with the chat's earlier choices filled in where it left them out (the model is
 * generate's, as a model named in the request wins), and what it kept.
 */
export function keptChoices(choices, input) {
  const next = { ...input };
  const kept = [];
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
export function assertAvoided({ name, brief }, prompts, list = "that avoid list") {
  const terms = brief.avoid
    .split(/[,;\n]+/)
    .map((term) => term.trim().replace(/^(?:no|without)\s+/i, ""))
    .filter(Boolean);
  for (const [index, prompt] of prompts.entries())
    for (const term of terms)
      if (new RegExp(`(?<![\\p{L}\\p{N}])${escape(term)}(?![\\p{L}\\p{N}])`, "iu").test(prompt))
        throw new Error(
          `Prompt ${index + 1} names "${term}", which ${name} avoids; models draw what a prompt names, even after "no". Leave it out and call generate again, or change ${list} if the user wants it.`,
        );
}

/** Refuses prompts that name any of the account's taste Dislikes, learnt or set. */
export const assertNotDisliked = ({ avoid }, prompts) =>
  assertAvoided(
    { name: "the user's taste", brief: { avoid: avoid.join("\n") } },
    prompts,
    "their Dislikes in Dream › Taste",
  );

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

/**
 * The account's chat brief and its taste profile's Dislikes, Models and LoRAs (the person's where
 * they set them, else what Studio learnt), for generate; taste may be unavailable to the account.
 */
export async function accountBrief(media, owner, signal) {
  const [brief, taste] = await Promise.all([
    media.request("GET", "/api/chat-brief", undefined, owner, { signal }),
    media.request("GET", "/api/taste", undefined, owner, { signal }).catch(() => null),
  ]);
  return {
    brief: brief?.brief || {},
    avoid: taste?.avoid || [],
    models: taste?.models || [],
    loras: taste?.loras || [],
  };
}

/** The account's brief and favourites as generate's reply gives them, models by label; "" when there is none. */
export function accountBriefLine({ brief, avoid, models, loras }, profiles = []) {
  const label = (id) => profiles.find((profile) => profile.id === id)?.label || id;
  const summary = [
    briefSummary(brief),
    models.length && `favourite models ${models.map(label).join(", ")}`,
    loras.length && `favourite LoRAs ${loras.join(", ")}`,
    avoid.length && `avoid ${avoid.join(", ")}`,
  ]
    .filter(Boolean)
    .join("; ");
  return summary ? `The user's brief: ${summary}. Keep every prompt to it. ` : "";
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
    const { id, name, brief, constraints } = project;
    return {
      id,
      name,
      brief,
      constraints: {
        ...constraints,
        profiles: constraints.profiles.map(label),
      },
    };
  };
  /**
   * The project tool's brief action: the user's own brief for all chats, from the fields it shares
   * with a project's (subjects, styles), with ethnicity, age and body. avoid, profiles and
   * lora_names set the taste profile's own Dislikes, Models and LoRAs ("" or [] hands one back to
   * what Studio learns). Only what is given changes.
   */
  const accountBriefAction = async ({ avoid, profiles, lora_names, ...change }, signal) => {
    const all = await media.profiles("all", owner).catch(() => []);
    const listed = avoid
      ?.split(/[,;\n]+/)
      .map((term) => term.trim())
      .filter(Boolean);
    const own = (list) => (list.length ? list : null);
    const preferences = {
      ...(listed ? { avoid: own(listed) } : {}),
      ...(profiles ? { models: own(await profileIds(profiles)) } : {}),
      ...(lora_names ? { loras: own(lora_names) } : {}),
    };
    const [{ brief }, taste] = await Promise.all([
      Object.keys(change).length
        ? api("PATCH", "/api/chat-brief", change, signal)
        : api("GET", "/api/chat-brief", undefined, signal),
      Object.keys(preferences).length ? api("PUT", "/api/taste", { preferences }, signal) : null,
    ]);
    const label = (id) => all.find((profile) => profile.id === id)?.label || id;
    return mcpJson({
      user_brief: brief,
      ...(taste
        ? { avoid: taste.avoid, profiles: taste.models.map(label), lora_names: taste.loras }
        : {}),
      ...(Object.keys(change).length || taste
        ? {
            note: "Tell the user it holds for every chat; Settings › Preferences and Dream › Taste edit it.",
          }
        : {}),
    });
  };
  tool(
    server,
    "project",
    "project",
    `The chat's project and constraints. show lists projects and the user's brief; attach (project), create, update (only changes) or detach. brief saves lasting rules for all chats ("" clears); avoid, profiles, lora_names set taste Dislikes and favourites.`,
    {
      action: z.enum(["show", "attach", "create", "update", "detach", "brief"]).optional(),
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
      if (action === "brief")
        return accountBriefAction(
          {
            ...brief,
            ...Object.fromEntries(
              Object.entries({ ethnicity, age, body: bodyType, profiles, lora_names }).filter(
                ([, value]) => value !== undefined,
              ),
            ),
          },
          signal,
        );
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
        const [{ projects }, { brief: own }] = await Promise.all([
          api("GET", "/api/dream/projects", undefined, signal),
          api("GET", "/api/chat-brief", undefined, signal),
        ]);
        return mcpJson({
          project: await shown(current),
          projects: projects.map(({ name }) => name),
          ...(Object.keys(own).length ? { user_brief: own } : {}),
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
