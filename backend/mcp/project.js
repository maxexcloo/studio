// A chat's project (domain/projects.ts): the project tool, and how generate keeps to its brief and constraints.
import { z } from "zod";

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
 * per kind and the count. Read and written through the runtime store on each call, so every
 * replica sees them.
 */
export function createChatChoices({ dataDir, now = Date.now }) {
  const key = (owner, chat) => `${owner || ""}\n${chat}`;
  const all = () => {
    try {
      return readRuntimeDocument(dataDir, "mcp-chat-choices");
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw error;
    }
  };
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
  const parts = ["subjects", "styles", "avoid"]
    .filter((key) => brief[key])
    .map((key) => `${key} ${brief[key]}`);
  return parts.length ? `Project ${name}: ${parts.join("; ")}. Keep prompts to it. ` : "";
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
    if (
      args.width !== undefined ||
      args.height !== undefined ||
      (args.aspect && args.aspect !== constraints.aspect)
    )
      notes.push(`${name} is ${constraints.aspect}, so it ran ${constraints.aspect}.`);
    delete next.width;
    delete next.height;
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
    .filter(Boolean);
  for (const [index, prompt] of prompts.entries())
    for (const term of terms)
      if (new RegExp(`(?<![\\p{L}\\p{N}])${escape(term)}(?![\\p{L}\\p{N}])`, "iu").test(prompt))
        throw new Error(
          `Prompt ${index + 1} names "${term}", which ${name} avoids; models draw what a prompt names, even after "no". Leave it out and call generate again, or update the project if the user wants it.`,
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
  tool(
    server,
    "project",
    "project",
    `The chat's project: a brief and constraints generate keeps to. action: show (default; lists projects), attach (project), create, update (only what changed) or detach. Use when the user wants something for the whole chat ("no LoRAs", "only turbo").`,
    {
      action: z.enum(["show", "attach", "create", "update", "detach"]).optional(),
      project: z.string().optional(),
      name: z.string().optional(),
      subjects: z.string().optional(),
      styles: z.string().optional(),
      avoid: z.string().optional(),
      profiles: z.array(z.string()).optional().describe('ids, names or a tier ("turbo"); [] any'),
      loras: z.boolean().optional(),
      aspect: z.string().optional(),
      resolution: z.string().optional(),
    },
    async (
      { action = "show", project, name, profiles, loras, aspect, resolution, ...brief },
      signal,
    ) => {
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
