import type { CardKind } from "./characters.ts";
import { type Resolution, imageAspects } from "./resolution.ts";

/**
 * A project brief's text: what its work shows and any standing rules (`description`), how it
 * looks (`styles`) and what prompts never name (`avoid`).
 */
export const projectBriefTextFields = ["description", "styles", "avoid"] as const;
export type ProjectBriefTextField = (typeof projectBriefTextFields)[number];
export const briefLabels: Record<ProjectBriefTextField, string> = {
  description: "Brief",
  styles: "Style",
  avoid: "Avoid",
};

export interface ProjectBrief extends Record<ProjectBriefTextField, string> {
  /** Favourite LoRA names, best first. */
  loras?: string[];
}
/** Generate inputs a project can keep within a range, by their GenerationInput names. */
export const projectRangeInputs = ["steps", "cfg", "denoise", "fps", "frames", "count"] as const;
export type ProjectRangeInput = (typeof projectRangeInputs)[number];
export const rangeLabels: Record<ProjectRangeInput, string> = {
  steps: "Steps",
  cfg: "CFG",
  denoise: "Denoise",
  fps: "FPS",
  frames: "Frames",
  count: "Count",
};
export interface ProjectRange {
  min?: number;
  max?: number;
}
/**
 * The generate inputs Dream and attached chats keep to. A list allows only its values, empty for
 * any; an unset switch allows either; a range bounds a number.
 */
export interface ProjectConstraints {
  /** Profiles by exact id. */
  profiles: string[];
  /** Aspects from `projectAspects`. */
  aspects: string[];
  resolutions: Resolution[];
  /** LoRA names, or "none" to run without LoRAs. */
  loras: string[] | "none";
  sound?: boolean;
  transparent?: boolean;
  ranges: Partial<Record<ProjectRangeInput, ProjectRange>>;
}
export const anyConstraints = (): ProjectConstraints => ({
  profiles: [],
  aspects: [],
  resolutions: [],
  loras: [],
  ranges: {},
});
/** Whether a project lets a LoRA run; without a project, any may. */
export const loraAllowed = (
  project: { constraints: ProjectConstraints } | undefined,
  name: string,
) =>
  !project ||
  (project.constraints.loras !== "none" &&
    (!project.constraints.loras.length || project.constraints.loras.includes(name)));
/**
 * Keeps an input's LoRAs, sound, transparency and numbers to the constraints, in place, and says
 * what changed ("Steps 20 → 8"). Sound and transparency apply only where the profile has them.
 */
export function fitProjectInput(
  constraints: ProjectConstraints,
  capabilities: Record<string, boolean> | undefined,
  input: Record<string, unknown>,
) {
  const changes: string[] = [];
  const { loras } = constraints;
  const stack = (input.loras ?? []) as { name: string }[];
  if (stack.length && (loras === "none" || loras.length)) {
    const kept = stack.filter((lora) => loras !== "none" && loras.includes(lora.name));
    if (kept.length < stack.length) {
      changes.push(kept.length ? "Only its allowed LoRAs" : "No LoRAs");
      input.loras = kept;
    }
  }
  for (const key of ["sound", "transparent"] as const) {
    const wanted = constraints[key];
    if (wanted === undefined || !capabilities?.[key]) continue;
    // Sound is on unless turned off; transparency is off unless turned on.
    if ((input[key] ?? key === "sound") !== wanted)
      changes.push(`${key === "sound" ? "Sound" : "Transparency"} ${wanted ? "on" : "off"}`);
    input[key] = wanted;
  }
  for (const key of projectRangeInputs) {
    const value = input[key];
    const { min = -Infinity, max = Infinity } = constraints.ranges[key] ?? {};
    if (typeof value !== "number" || (value >= min && value <= max)) continue;
    const next = Math.min(max, Math.max(min, value));
    changes.push(`${rangeLabels[key]} ${value} → ${next}`);
    input[key] = next;
  }
  return changes;
}
export interface ProjectContent {
  name: string;
  brief: ProjectBrief;
  constraints: ProjectConstraints;
  /** Account-owned cards that stay fixed when Dream varies an idea. */
  cards?: Partial<Record<CardKind, string>>;
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
  /** What changed: "name", brief fields, "constraints", "cards", "paused", "favoured", or "created". */
  fields: string[];
  /** Each changed text field's words before and after: the name, the brief's text and its LoRAs. */
  text?: Record<string, { before: string; after: string }>;
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

/** The shapes, then every standard ratio but 1:1, which square already is. */
export const projectAspects = [
  "square",
  "portrait",
  "landscape",
  ...imageAspects.filter((aspect) => aspect !== "1:1"),
];
export const maxProjectName = 80;
export const maxProjectBrief = 600;
export const maxProjectProfiles = 20;
export const maxProjectLoras = 8;
export const maxProjectChanges = 20;

/** How a result keeps its project's brief, from 1 to 10 (backend/domain/review.ts). */
export interface Review {
  score: number;
  /** What misses the brief; empty when the result fits it. */
  miss: string;
  model: string;
  at: string;
  /** A short hash of the brief it was checked against: a changed brief makes it due again. */
  brief?: string;
}
/** The brief's text as one line, "…; styles …; avoid …"; "" when empty. */
export function briefSummary(brief: Partial<ProjectBrief>) {
  return [
    brief.description,
    brief.styles && `styles ${brief.styles}`,
    brief.avoid && `avoid ${brief.avoid}`,
  ]
    .filter(Boolean)
    .join("; ");
}
