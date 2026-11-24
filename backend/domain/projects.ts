import { randomUUID } from "node:crypto";

import { type Card, type CardKind, cardKinds } from "../../shared/characters.ts";
import {
  type ChangeBy,
  type Project,
  type ProjectConstraints,
  type ProjectContent,
  type ProjectRange,
  type ProjectRangeInput,
  anyConstraints,
  maxProjectBrief,
  maxProjectChanges,
  maxProjectLoras,
  maxProjectName,
  maxProjectProfiles,
  projectAspects,
  projectBriefTextFields,
  projectRangeInputs,
} from "../../shared/projects.ts";
import { type Resolution, resolutions } from "../../shared/resolution.ts";
import { readRuntimeDocument, writeRuntimeDocument } from "../persistence/runtime.ts";

/** Each chat's project and when the chat last asked for something (Dream takes over a quiet one). */
export type Chats = Record<string, { projectId: string; at: string }>;
interface ProjectsRecord {
  projects: Project[];
  chats: Chats;
}
/** What a create or update may carry: any part of a project's content. */
interface ProjectPatch {
  name?: string;
  brief?: Partial<ProjectContent["brief"]>;
  /** A null switch clears it, allowing either. */
  constraints?: Partial<
    Omit<ProjectConstraints, "sound" | "transparent"> &
      Record<"sound" | "transparent", boolean | null>
  >;
  cards?: ProjectContent["cards"];
  paused?: boolean;
  favoured?: boolean;
}

const maxProjects = 50;
const maxChats = 200;
const failure = (message: string, status: number) => Object.assign(new Error(message), { status });
const text = (value: unknown, field: string, max: number) => {
  if (typeof value !== "string") throw failure(`Set ${field} to text.`, 400);
  if (value.trim().length > max)
    throw failure(
      `${field} is ${value.trim().length} characters; shorten it to at most ${max}.`,
      400,
    );
  return value.trim();
};

/** A list of distinct choices: at most `allowed` of them, or only those `allowed` names. */
function list(value: unknown, field: string, allowed: number | readonly string[]) {
  const max = typeof allowed === "number" ? allowed : allowed.length;
  if (
    !Array.isArray(value) ||
    value.length > max ||
    value.some(
      (item) =>
        typeof item !== "string" ||
        !item ||
        (typeof allowed !== "number" && !allowed.includes(item)),
    )
  )
    throw failure(
      typeof allowed === "number"
        ? `List at most ${max} ${field}.`
        : `List ${field} from ${allowed.join(", ")}, or none for any.`,
      400,
    );
  return [...new Set(value as string[])];
}
const loraNames = (value: unknown, field: string) => {
  if (
    !Array.isArray(value) ||
    value.length > maxProjectLoras ||
    value.some((name) => typeof name !== "string" || !name.trim() || name.length > 200)
  )
    throw failure(`List at most ${maxProjectLoras} ${field}.`, 400);
  return [...new Set(value.map((name: string) => name.trim()))];
};
/** Each range's bounds, either of which may be left open; an empty range is dropped. */
function rangesOf(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw failure("Set ranges to an object of { min, max } by input.", 400);
  const ranges: ProjectConstraints["ranges"] = {};
  for (const [key, range] of Object.entries(value)) {
    if (!(projectRangeInputs as readonly string[]).includes(key))
      throw failure(`Ranges cover ${projectRangeInputs.join(", ")}, not ${key}.`, 400);
    const { min, max, ...other } = (range || {}) as ProjectRange;
    if (
      Object.keys(other).length ||
      [min, max].some((bound) => bound !== undefined && !Number.isFinite(bound)) ||
      (min !== undefined && max !== undefined && min > max)
    )
      throw failure(`Give ${key} a min no greater than its max.`, 400);
    if (min !== undefined || max !== undefined)
      ranges[key as ProjectRangeInput] = {
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
      };
  }
  return ranges;
}

/** A patch from a request body, checked field by field; unknown fields are refused. */
export function projectPatch(body: unknown): ProjectPatch {
  const { name, brief, constraints, cards, paused, favoured, ...rest } = (body || {}) as Record<
    string,
    any
  >;
  if (Object.keys(rest).length) throw failure(`Unknown field ${Object.keys(rest)[0]}.`, 400);
  const patch: ProjectPatch = {};
  for (const [key, value] of Object.entries({ paused, favoured }))
    if (value !== undefined) {
      if (typeof value !== "boolean") throw failure(`Set ${key} to true or false.`, 400);
      Object.assign(patch, { [key]: value });
    }
  if (name !== undefined) {
    patch.name = text(name, "name", maxProjectName);
    if (!patch.name) throw failure("Name the project.", 400);
  }
  if (brief !== undefined) {
    const { loras, ...texts } = brief || {};
    const other = Object.keys(texts).find(
      (key) => !(projectBriefTextFields as readonly string[]).includes(key),
    );
    if (other) throw failure(`Unknown brief field ${other}.`, 400);
    patch.brief = Object.fromEntries(
      Object.entries(texts)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, text(value, key, maxProjectBrief)]),
    );
    if (loras !== undefined) patch.brief.loras = loraNames(loras, "favourite LoRAs");
  }
  if (constraints !== undefined) {
    const { profiles, aspects, resolutions: sizes, loras, ranges, ...switches } = constraints || {};
    const next: ProjectPatch["constraints"] = {};
    for (const [key, value] of Object.entries(switches)) {
      if (key !== "sound" && key !== "transparent")
        throw failure(`Unknown constraint ${key}.`, 400);
      if (value !== null && typeof value !== "boolean")
        throw failure(`Set ${key} to true, false or null for either.`, 400);
      next[key as "sound" | "transparent"] = value as boolean | null;
    }
    if (profiles !== undefined) next.profiles = list(profiles, "profiles", maxProjectProfiles);
    if (aspects !== undefined) next.aspects = list(aspects, "aspects", projectAspects);
    if (sizes !== undefined)
      next.resolutions = list(sizes, "resolutions", resolutions) as Resolution[];
    if (loras !== undefined) next.loras = loras === "none" ? "none" : loraNames(loras, "LoRAs");
    if (ranges !== undefined) next.ranges = rangesOf(ranges);
    patch.constraints = next;
  }
  if (cards !== undefined) {
    if (!cards || typeof cards !== "object" || Array.isArray(cards))
      throw failure("Choose cards to pin.", 400);
    patch.cards = {};
    for (const [kind, id] of Object.entries(cards)) {
      if (!Object.hasOwn(cardKinds, kind) || typeof id !== "string" || !id || id.length > 100)
        throw failure("Choose a saved Character, Outfit or Scene.", 400);
      patch.cards[kind as CardKind] = id;
    }
  }
  return patch;
}

/** Constraints with a patch's over them; a null switch clears it. */
export const mergedConstraints = (
  base: ProjectConstraints,
  patch: ProjectPatch["constraints"] = {},
) =>
  Object.fromEntries(
    Object.entries({ ...base, ...patch }).filter(([, value]) => value !== null),
  ) as unknown as ProjectConstraints;

/**
 * Styles with a pick on one axis ("lighting: warm dusk"), replacing the axis's earlier pick; the
 * oldest parts give way where the result would exceed the brief's length.
 */
export function stylesWithChoice(styles: string, axis: string, choice: string) {
  const prefix = `${axis.trim().toLowerCase()}:`;
  const parts = [
    ...styles
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part && !part.toLowerCase().startsWith(prefix)),
    `${axis.trim().toLowerCase()}: ${choice.trim()}`,
  ];
  while (parts.length > 1 && parts.join("; ").length > maxProjectBrief) parts.shift();
  return parts.join("; ").slice(0, maxProjectBrief);
}

/**
 * Each account's projects (a brief and sticky constraints) and which chat each is attached to,
 * in the runtime document store as `projects:<ownerId>`.
 */
export function createProjects({
  cards,
  dataDir,
  now = Date.now,
}: {
  cards?: (ownerId: string) => Record<CardKind, Card[]> | null;
  dataDir: string;
  now?: () => number;
}) {
  const name = (ownerId: string) => `projects:${ownerId}`;
  function read(ownerId: string): ProjectsRecord {
    return (
      (readRuntimeDocument(dataDir, name(ownerId)) as ProjectsRecord | undefined) ?? {
        projects: [],
        chats: {},
      }
    );
  }
  const write = (ownerId: string, record: ProjectsRecord) =>
    writeRuntimeDocument(dataDir, name(ownerId), record);
  const stamp = () => new Date(now()).toISOString();
  const find = (record: ProjectsRecord, id: string) => {
    const project = record.projects.find((entry) => entry.id === id);
    if (!project) throw failure("That project no longer exists.", 404);
    return project;
  };
  const content = ({ name, brief, constraints, cards, paused, favoured }: ProjectContent) =>
    structuredClone({
      name,
      brief,
      constraints,
      ...(cards && Object.keys(cards).length ? { cards } : {}),
      ...(paused ? { paused } : {}),
      ...(favoured ? { favoured } : {}),
    }) as ProjectContent;
  const merged = (base: ProjectContent, patch: ProjectPatch) =>
    content({
      name: patch.name ?? base.name,
      brief: { ...base.brief, ...patch.brief },
      constraints: mergedConstraints(base.constraints, patch.constraints),
      cards: patch.cards ?? base.cards,
      paused: patch.paused ?? base.paused,
      favoured: patch.favoured ?? base.favoured,
    });
  /** What differs between two versions of a project: "name", brief fields and so on. */
  const changed = (before: ProjectContent, after: ProjectContent) => {
    const same = (a: unknown, b: unknown) => JSON.stringify(a || "") === JSON.stringify(b || "");
    const briefKeys = [...new Set([...Object.keys(before.brief), ...Object.keys(after.brief)])];
    return [
      ...(same(before.name, after.name) ? [] : ["name"]),
      ...briefKeys.filter(
        (key) => !same(before.brief[key as "styles"], after.brief[key as "styles"]),
      ),
      ...(["constraints", "cards", "paused", "favoured"] as const).filter(
        (key) => !same(before[key], after[key]),
      ),
    ];
  };
  /** Replaces a project's content, dropping flags the new content leaves unset. */
  const assign = (project: Project, next: ProjectContent) => {
    delete project.cards;
    delete project.paused;
    delete project.favoured;
    Object.assign(project, next);
  };
  function checkCards(ownerId: string, patch: ProjectPatch, previous?: ProjectContent["cards"]) {
    if (!patch.cards) return;
    const changed = (Object.keys(cardKinds) as CardKind[]).filter(
      (kind) => patch.cards?.[kind] && patch.cards[kind] !== previous?.[kind],
    );
    if (!changed.length) return;
    const owned = cards?.(ownerId);
    for (const kind of changed)
      if (!owned?.[kind].some((card) => card.id === patch.cards?.[kind]))
        throw failure(`That ${cardKinds[kind].name} no longer exists in your Library.`, 400);
  }
  /** Refuses a name another of the account's projects has, in any case. */
  function checkName(record: ProjectsRecord, name: string | undefined, id?: string) {
    const key = (text: string) => text.normalize("NFKC").toLowerCase();
    if (
      name &&
      record.projects.some((project) => project.id !== id && key(project.name) === key(name))
    )
      throw failure(`You already have a project named ${name}.`, 409);
  }
  /** A chat's attached project, or null; a missing project detaches it. */
  const attached = (record: ProjectsRecord, chat: string) => {
    const projectId = record.chats[chat]?.projectId;
    return record.projects.find((project) => project.id === projectId) || null;
  };
  const remember = (record: ProjectsRecord, chat: string, projectId: string) => {
    record.chats[chat] = { projectId, at: stamp() };
    const chats = Object.entries(record.chats);
    if (chats.length > maxChats)
      record.chats = Object.fromEntries(
        chats.sort(([, a], [, b]) => b.at.localeCompare(a.at)).slice(0, maxChats),
      );
  };
  return {
    list: (ownerId: string) => read(ownerId).projects,
    /** Each attached chat's project and latest request, by conversation id. */
    chats: (ownerId: string) => read(ownerId).chats,
    /** A chat's project, without noting activity. */
    chatProject: (ownerId: string, chat: string) => attached(read(ownerId), chat),
    /** Makes a project; one Dream proposed notes why. */
    create(ownerId: string, patch: ProjectPatch, why = "") {
      if (!patch.name) throw failure("Name the project.", 400);
      checkCards(ownerId, patch);
      const record = read(ownerId);
      checkName(record, patch.name);
      if (record.projects.length >= maxProjects)
        throw failure(`Keep to ${maxProjects} projects; delete one first.`, 409);
      const at = stamp();
      const changes = why
        ? [{ id: randomUUID(), at, by: "dream" as const, why, fields: ["created"] }]
        : undefined;
      const project: Project = {
        id: randomUUID(),
        ...merged(
          {
            name: patch.name,
            brief: { description: "", styles: "", avoid: "" },
            constraints: anyConstraints(),
          },
          patch,
        ),
        createdAt: at,
        updatedAt: at,
        ...(changes ? { changes } : {}),
      };
      record.projects.push(project);
      write(ownerId, record);
      return project;
    },
    /**
     * Changes a project, keeping what it replaced for one Undo, and notes who changed what and,
     * for Dream's proposals, why. A patch that changes nothing leaves it as it was.
     */
    update(ownerId: string, id: string, patch: ProjectPatch, by: ChangeBy, why = "") {
      const record = read(ownerId);
      const project = find(record, id);
      const before = content(project);
      checkName(record, patch.name, id);
      checkCards(ownerId, patch, before.cards);
      const after = merged(project, patch);
      const fields = changed(before, after);
      if (!fields.length) return project;
      const words = (version: ProjectContent, field: string) => {
        const value = field === "name" ? version.name : version.brief[field as "loras"];
        return Array.isArray(value) ? value.join(", ") : value || "";
      };
      const text = Object.fromEntries(
        fields
          .filter((field) => field === "name" || field in before.brief || field in after.brief)
          .map((field) => [field, { before: words(before, field), after: words(after, field) }]),
      );
      const change = {
        id: randomUUID(),
        at: stamp(),
        by,
        why,
        fields,
        ...(Object.keys(text).length ? { text } : {}),
      };
      assign(project, after);
      project.previous = { ...before, change: change.id };
      project.changes = [change, ...(project.changes || [])].slice(0, maxProjectChanges);
      project.updatedAt = change.at;
      write(ownerId, record);
      return project;
    },
    /** Takes back the latest change, once. */
    undo(ownerId: string, id: string) {
      const record = read(ownerId);
      const project = find(record, id);
      if (!project.previous) throw failure("There is nothing to undo.", 409);
      const { change, ...previous } = project.previous;
      assign(project, previous);
      project.changes = (project.changes || []).map((entry) =>
        entry.id === change ? { ...entry, undone: true as const } : entry,
      );
      project.updatedAt = stamp();
      delete project.previous;
      write(ownerId, record);
      return project;
    },
    remove(ownerId: string, id: string) {
      const record = read(ownerId);
      find(record, id);
      record.projects = record.projects.filter((project) => project.id !== id);
      for (const [chat, entry] of Object.entries(record.chats))
        if (entry.projectId === id) delete record.chats[chat];
      write(ownerId, record);
    },
    /** Attaches a chat to a project, or detaches it with null. */
    attach(ownerId: string, chat: string, projectId: string | null) {
      const record = read(ownerId);
      if (projectId === null) delete record.chats[chat];
      else remember(record, chat, find(record, projectId).id);
      write(ownerId, record);
      return projectId === null ? null : attached(record, chat);
    },
    /** A chat's project, noting that the chat just asked for something. */
    activity(ownerId: string, chat: string) {
      const record = read(ownerId);
      const project = attached(record, chat);
      if (!project) return null;
      remember(record, chat, project.id);
      write(ownerId, record);
      return project;
    },
  };
}
export type Projects = ReturnType<typeof createProjects>;
