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
  /** A paused project takes no turns. */
  paused?: boolean;
  /** Dream gives it twice the turns its results earn. */
  favoured?: boolean;
}
/** Who changed a project: the person in Studio, a chat attached to it, or Dream's accepted proposal. */
export type ChangeBy = "you" | "chat" | "dream";
export interface ProjectChange {
  id: string;
  at: string;
  by: ChangeBy;
  /** Why Dream proposed it; "" for the person's and chats' own changes. */
  why: string;
  /** What changed: "name", brief fields, "constraints", "paused", "favoured", or "created". */
  fields: string[];
  /** Undo took it back. */
  undone?: true;
}
export interface Project extends ProjectContent {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** What the latest change (`change`, its id) replaced, which Undo restores: one level. */
  previous?: ProjectContent & { change: string };
  /** Its changes, newest first, at most `maxProjectChanges`. */
  changes?: ProjectChange[];
}
/** How a project's Dream results fare, and its share of Dream's project turns. */
export interface ProjectStats<Item> {
  kept: number;
  liked: number;
  /** Results whose review says they miss the brief. */
  missed: number;
  discarded: number;
  /** The average review score from 1 to 10, or null before any review. */
  review: number | null;
  /** Its share of the turns Dream gives projects, from 0 to 1; 0 while paused. */
  share: number;
  /** Its newest results that weren't discarded, newest first. */
  results: Item[];
}

export const projectAspects = ["square", "portrait", "landscape", "16:9", "9:16", "3:2", "2:3"];
export const maxProjectName = 80;
export const maxProjectBrief = 600;
export const maxProjectProfiles = 20;
export const maxProjectLoras = 8;
export const maxProjectChanges = 20;

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
