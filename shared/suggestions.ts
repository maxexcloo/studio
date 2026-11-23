/** A short menu title and the complete prompt applied on selection. */
export interface PromptIdea {
  label: string;
  prompt: string;
}
/** A suggestion names a change. Studio writes the new prompt when the person chooses it. */
export interface NextStep {
  label: string;
  request: string;
  prompt?: string;
}
/** The number of distinct ideas requested for a generated suggestion picker. */
export const maxSuggestions = 10;
/** Maximum reference images supplied to a composer suggestion. */
export const maxSuggestionReferences = 4;
/** How a requested change is carried out; a composer draft has nothing to upscale. */
export const changeActions = ["edit", "recreate", "animate", "upscale"] as const;
export type ChangeAction = (typeof changeActions)[number];
/** A change asked for in plain words: the action the text model chose, with its prompt. */
export interface Change extends NextStep {
  action: ChangeAction;
  prompt: string;
}
export const variationDirections = ["scene", "outfit", "style"] as const;
export type VariationDirection = (typeof variationDirections)[number];
/** `POST /api/suggestions`: none, with the reason, where the account or the text model can't. */
export type Suggestions<T = PromptIdea> =
  | { suggestions: T[]; reason?: undefined }
  | { suggestions: []; reason: string };

export type ImageInspection =
  | { status: "issue"; issue: string }
  | { status: "clear" }
  | { status: "unavailable"; reason: string };
