import { promptWords } from "./titles.ts";

/** How many variants one compare set holds, wherever a set is chosen, run or recorded. */
export const compareVariants = { min: 2, max: 10 };

/** The legacy title of a compare run's result set; new runs use `comparisonTitle` ("Compare: …"). */
export const comparisonSetTitle = "Comparison";

/** A descriptive result-set title for a comparison run ("Compare Steps: Amber Bird", "Compare: Amber Bird"). */
export function comparisonTitle(prompt?: unknown, axis?: string) {
  const subject = promptWords(typeof prompt === "string" ? prompt : "");
  const cleanAxis = String(axis || "").trim();
  const prefix = cleanAxis ? `Compare ${cleanAxis}` : "Compare";
  return subject ? `${prefix}: ${subject}`.slice(0, 80) : cleanAxis ? prefix : comparisonSetTitle;
}

/** Whether a result set belongs to a comparison (legacy "Comparison" or "Compare…" title). */
export const isComparisonSet = (set?: { title?: string; source?: string }) =>
  Boolean(
    set?.source === "compare" ||
    set?.title === comparisonSetTitle ||
    (set?.title && /^Compare(?: |:)/.test(set.title)),
  );

/** A variant's letter by its index: A, B, C… */
export const letter = (index: number) => String.fromCharCode(65 + index);

export type ComparisonRating = "liked" | "disliked";
