import { randomUUID } from "node:crypto";

import {
  type ChangeBy,
  type Project,
  type ProjectContent,
  maxProjectBrief,
  maxProjectChanges,
  maxProjectLoras,
  maxProjectName,
  maxProjectProfiles,
  projectAspects,
} from "../../shared/projects.ts";
import { resolutions } from "../../shared/resolution.ts";
import { readRuntimeDocument, writeRuntimeDocument } from "../persistence/runtime.ts";

/** Each chat's project and when the chat last asked for something (Dream takes over a quiet one). */
export type Chats = Record<string, { projectId: string; at: string }>;
interface ProjectsRecord {
  projects: Project[];
  chats: Chats;
}
/** What a create or update may carry: any part of a project's content. */
export interface ProjectPatch {
  name?: string;
  brief?: Partial<ProjectContent["brief"]>;
  constraints?: Partial<ProjectContent["constraints"]>;
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

/** A patch from a request body, checked field by field; unknown fields are refused. */
export function projectPatch(body: unknown): ProjectPatch {
  const { name, brief, constraints, paused, favoured, ...rest } = (body || {}) as Record<
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
    const { subjects, styles, avoid, ethnicity, age, body, rules, loras, ...other } = brief || {};
    if (Object.keys(other).length)
      throw failure(`Unknown brief field ${Object.keys(other)[0]}.`, 400);
    patch.brief = Object.fromEntries(
      Object.entries({ subjects, styles, avoid })
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, text(value, key, maxProjectBrief)]),
    );
    for (const [key, value] of Object.entries({ ethnicity, age, body, rules }))
      if (value !== undefined)
        Object.assign(patch.brief, { [key]: text(value, key, maxProjectBrief) });
    if (loras !== undefined) {
      if (
        !Array.isArray(loras) ||
        loras.length > maxProjectLoras ||
        loras.some((name) => typeof name !== "string" || !name.trim() || name.length > 200)
      )
        throw failure(`List at most ${maxProjectLoras} favourite LoRAs.`, 400);
      patch.brief.loras = [...new Set(loras.map((name: string) => name.trim()))];
    }
  }
  if (constraints !== undefined) {
    const { profiles, loras, aspect, resolution, ...other } = constraints || {};
    if (Object.keys(other).length)
      throw failure(`Unknown constraint ${Object.keys(other)[0]}.`, 400);
    const next: ProjectPatch["constraints"] = {};
    if (profiles !== undefined) {
      if (
        !Array.isArray(profiles) ||
        profiles.length > maxProjectProfiles ||
        profiles.some((id) => typeof id !== "string" || !id)
      )
        throw failure(`List at most ${maxProjectProfiles} profile ids.`, 400);
      next.profiles = [...new Set(profiles as string[])];
    }
    if (loras !== undefined) {
      if (typeof loras !== "boolean") throw failure("Set loras to true or false.", 400);
      next.loras = loras;
    }
    if (aspect !== undefined) {
      if (aspect !== "" && !projectAspects.includes(aspect))
        throw failure(`Set aspect to one of ${projectAspects.join(", ")}, or "" for any.`, 400);
      next.aspect = aspect;
    }
    if (resolution !== undefined) {
      if (resolution !== "" && !(resolutions as readonly string[]).includes(resolution))
        throw failure(`Set resolution to one of ${resolutions.join(", ")}, or "" for any.`, 400);
      next.resolution = resolution;
    }
    patch.constraints = next;
  }
  return patch;
}

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
  dataDir,
  now = Date.now,
}: {
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
  const content = ({ name, brief, constraints, paused, favoured }: ProjectContent) =>
    structuredClone({
      name,
      brief,
      constraints,
      ...(paused ? { paused } : {}),
      ...(favoured ? { favoured } : {}),
    }) as ProjectContent;
  const merged = (base: ProjectContent, patch: ProjectPatch) =>
    content({
      name: patch.name ?? base.name,
      brief: { ...base.brief, ...patch.brief },
      constraints: { ...base.constraints, ...patch.constraints },
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
      ...(["constraints", "paused", "favoured"] as const).filter(
        (key) => !same(before[key], after[key]),
      ),
    ];
  };
  /** Replaces a project's content, dropping flags the new content leaves unset. */
  const assign = (project: Project, next: ProjectContent) => {
    delete project.paused;
    delete project.favoured;
    Object.assign(project, next);
  };
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
    /** Makes a project; one Dream proposed notes why. */
    create(ownerId: string, patch: ProjectPatch, why = "") {
      if (!patch.name) throw failure("Name the project.", 400);
      const record = read(ownerId);
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
            brief: { subjects: "", styles: "", avoid: "" },
            constraints: { profiles: [], loras: true, aspect: "", resolution: "" },
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
      const after = merged(project, patch);
      const fields = changed(before, after);
      if (!fields.length) return project;
      const change = { id: randomUUID(), at: stamp(), by, why, fields };
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
