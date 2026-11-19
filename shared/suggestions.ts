/** A short menu title and the complete prompt applied on selection. */
export interface PromptIdea {
  label: string;
  prompt: string;
}
/** A viewer next step also names the change in words. */
export interface NextStep extends PromptIdea {
  request: string;
}
/** The number of distinct ideas requested for a generated suggestion picker. */
export const maxSuggestions = 6;
/** How a requested change is carried out; a composer draft has nothing to upscale. */
export const changeActions = ["edit", "recreate", "animate", "upscale"] as const;
export type ChangeAction = (typeof changeActions)[number];
/** A change asked for in plain words: the action the text model chose, with its prompt. */
export interface Change extends NextStep {
  action: ChangeAction;
}
/** `POST /api/suggestions`: none, with the reason, where the account or the text model can't. */
export type Suggestions<T = PromptIdea> =
  | { suggestions: T[]; reason?: undefined }
  | { suggestions: []; reason: string };
