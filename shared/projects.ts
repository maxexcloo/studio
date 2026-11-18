import type { Resolution } from "./resolution.ts";

/** A project brief's free-text fields, in the order its one-line summary lists them. */
const briefTexts = ["subjects", "ethnicity", "age", "body", "styles", "rules"] as const;

/** What a project's work shows, how it looks and what it leaves out. */
export interface ProjectBrief extends Partial<Record<(typeof briefTexts)[number], string>> {
  subjects: string;
  styles: string;
  avoid: string;
  /** Favourite LoRA names, best first. */
  loras?: string[];
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
export const maxProjectLoras = 8;

/** How a result keeps its owner's rules and any project's brief, from 1 to 10 (backend/domain/review.ts). */
export interface Review {
  score: number;
  /** What misses the brief; empty when the result fits it. */
  miss: string;
  model: string;
  at: string;
  /** A short hash of the brief it was checked against: a changed brief makes it due again. */
  brief?: string;
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

/** The brief's free text as one line, "subjects …; age …"; "" when empty. */
export function briefSummary(brief: Partial<ProjectBrief>) {
  return briefTexts
    .filter((key) => brief[key])
    .map((key) => `${key} ${brief[key]}`)
    .join("; ");
}
