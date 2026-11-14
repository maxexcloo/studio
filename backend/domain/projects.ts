import { randomUUID } from "node:crypto";
import { resolutions } from "../../shared/resolution.ts";
import {
  maxProjectBrief,
  maxProjectName,
  maxProjectProfiles,
  projectAspects,
  type Project,
  type ProjectContent,
} from "../../shared/projects.ts";
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
}

const maxProjects = 50;
const maxChats = 200;
const failure = (message: string, status: number) => Object.assign(new Error(message), { status });
const text = (value: unknown, field: string, max: number) => {
  if (typeof value !== "string") throw failure(`Set ${field} to text.`, 400);
  if (value.trim().length > max) throw failure(`Keep ${field} to ${max} characters.`, 400);
  return value.trim();
};

/** A patch from a request body, checked field by field; unknown fields are refused. */
export function projectPatch(body: unknown): ProjectPatch {
  const { name, brief, constraints, ...rest } = (body || {}) as Record<string, any>;
  if (Object.keys(rest).length) throw failure(`Unknown field ${Object.keys(rest)[0]}.`, 400);
  const patch: ProjectPatch = {};
  if (name !== undefined) {
    patch.name = text(name, "name", maxProjectName);
    if (!patch.name) throw failure("Name the project.", 400);
  }
  if (brief !== undefined) {
    const { subjects, styles, avoid, ...other } = brief || {};
    if (Object.keys(other).length)
      throw failure(`Unknown brief field ${Object.keys(other)[0]}.`, 400);
    patch.brief = Object.fromEntries(
      Object.entries({ subjects, styles, avoid })
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, text(value, key, maxProjectBrief)]),
    );
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
    try {
      return readRuntimeDocument(dataDir, name(ownerId)) as ProjectsRecord;
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return { projects: [], chats: {} };
      throw error;
    }
  }
  const write = (ownerId: string, record: ProjectsRecord) =>
    writeRuntimeDocument(dataDir, name(ownerId), record);
  const stamp = () => new Date(now()).toISOString();
  const find = (record: ProjectsRecord, id: string) => {
    const project = record.projects.find((entry) => entry.id === id);
    if (!project) throw failure("That project no longer exists.", 404);
    return project;
  };
  const content = ({ name, brief, constraints }: ProjectContent): ProjectContent =>
    structuredClone({ name, brief, constraints });
  const merged = (base: ProjectContent, patch: ProjectPatch): ProjectContent => ({
    name: patch.name ?? base.name,
    brief: { ...base.brief, ...patch.brief },
    constraints: { ...base.constraints, ...patch.constraints },
  });
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
    create(ownerId: string, patch: ProjectPatch) {
      if (!patch.name) throw failure("Name the project.", 400);
      const record = read(ownerId);
      if (record.projects.length >= maxProjects)
        throw failure(`Keep to ${maxProjects} projects; delete one first.`, 409);
      const at = stamp();
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
      };
      record.projects.push(project);
      write(ownerId, record);
      return project;
    },
    /** Changes a project, keeping what it replaced for Undo. */
    update(ownerId: string, id: string, patch: ProjectPatch, by: "chat" | "studio") {
      const record = read(ownerId);
      const project = find(record, id);
      const previous = content(project);
      Object.assign(project, merged(project, patch), {
        previous: { ...previous, by },
        updatedAt: stamp(),
      });
      write(ownerId, record);
      return project;
    },
    undo(ownerId: string, id: string) {
      const record = read(ownerId);
      const project = find(record, id);
      if (!project.previous) throw failure("There is nothing to undo.", 409);
      const { by: _by, ...previous } = project.previous;
      Object.assign(project, previous, { updatedAt: stamp() });
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
