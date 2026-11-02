/** A viewer next step: a short label, the change in words and the item's prompt with it applied. */
export interface NextStep {
  label: string;
  request: string;
  prompt: string;
}
/** How the viewer carries out a requested change. */
export const changeActions = ["edit", "recreate", "animate", "upscale"] as const;
export type ChangeAction = (typeof changeActions)[number];
/** The viewer's plain-language change: the action the text model chose, with its prompt. */
export interface Change extends NextStep {
  action: ChangeAction;
}
/** `POST /api/suggestions`: none, with the reason, where the account or the text model can't. */
export type Suggestions<T = string | NextStep> =
  | { suggestions: T[]; reason?: undefined }
  | { suggestions: []; reason: string };
