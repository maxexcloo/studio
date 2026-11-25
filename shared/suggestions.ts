/** A short menu title and brief, with the complete prompt applied on selection. */
export interface PromptIdea {
  label: string;
  brief?: string;
  prompt: string;
}
/** A suggestion names a change. Studio writes the new prompt when the person chooses it. */
export interface NextStep {
  label: string;
  brief?: string;
  request: string;
  prompt?: string;
}
/** The number of distinct ideas requested for a generated suggestion picker. */
export const maxSuggestions = 10;
/** Maximum length of the line under a suggestion or template name. */
export const maxMenuBrief = 60;
/** Maximum reference images supplied to a composer suggestion. */
export const maxSuggestionReferences = 4;
/** How a requested change is carried out; a composer draft has nothing to upscale. */
export const changeActions = ["edit", "recreate", "animate", "upscale"] as const;
export type ChangeAction = (typeof changeActions)[number];
export const imageChangeActions = ["edit", "recreate"] as const;
export type ImageChangeAction = (typeof imageChangeActions)[number];
/** A change asked for in plain words: the action the text model chose, with its prompt. */
export interface Change extends NextStep {
  action: ChangeAction;
  prompt: string;
  /** The reference backend that supplied an Edit prompt's guide on a combined profile. */
  profileBackend?: string;
}
export const variationDirections = ["light", "outfit", "pose", "scene", "style"] as const;
export type VariationDirection = (typeof variationDirections)[number];
/** Explore Three Directions: one variation each. */
export const exploreDirections: VariationDirection[] = ["scene", "outfit", "style"];
/** Varying one direction alone writes this many variations of it, to compare. */
export const directionVariants = 4;
/** `POST /api/suggestions`: none, with the reason, where the account or the text model can't. */
export type Suggestions<T = PromptIdea> =
  | { suggestions: T[]; reason?: undefined }
  | { suggestions: []; reason: string };

export type ImageInspection =
  | { status: "issue"; issue: string }
  | { status: "clear" }
  | { status: "unavailable"; reason: string };
