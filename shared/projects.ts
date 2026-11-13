import type { Resolution } from "./resolution.ts";

/** What a project's work shows, how it looks and what it leaves out. */
export interface ProjectBrief {
  subjects: string;
  styles: string;
  avoid: string;
}
/** What every generate from an attached chat keeps to. */
export interface ProjectConstraints {
  /** The only profiles it runs on, by exact id; none for any. */
  profiles: string[];
  loras: boolean;
  /** An aspect from `projectAspects`, or "" for any. */
  aspect: string;
  resolution: Resolution | "";
}
export interface ProjectContent {
  name: string;
  brief: ProjectBrief;
  constraints: ProjectConstraints;
}
export interface Project extends ProjectContent {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** What the latest change replaced, which Undo restores, and whether a chat or Studio made it. */
  previous?: ProjectContent & { by: "chat" | "studio" };
}

export const projectAspects = ["square", "portrait", "landscape", "16:9", "9:16", "3:2", "2:3"];
export const maxProjectName = 80;
export const maxProjectBrief = 600;
export const maxProjectProfiles = 20;

/** How a Dream result fits its project's brief, from 1 to 10 (backend/domain/review.ts). */
export interface Review {
  score: number;
  /** What misses the brief; empty when the result fits it. */
  miss: string;
  model: string;
  at: string;
}
/** One project's unseen Dream results in While You Were Away. */
export interface DigestGroup<Item> {
  /** The project, or null for results without one (or whose project is gone). */
  projectId: string | null;
  name: string;
  /** Fitting and unreviewed results: best score first, unreviewed after, newest first among equals. */
  items: Item[];
  /** Results that miss the brief, best score first, kept for the person to judge. */
  misses: Item[];
}
