/** A viewer next step: a short label, the change in words and the item's prompt with it applied. */
export interface NextStep {
  label: string;
  request: string;
  prompt: string;
}
/** `POST /api/suggestions`: none, with the reason, where the account or the text model can't. */
export type Suggestions<T = string | NextStep> =
  | { suggestions: T[]; reason?: undefined }
  | { suggestions: []; reason: string };
