/** How many variants one compare set holds, wherever a set is chosen, run or recorded. */
export const compareVariants = { min: 2, max: 10 };

/** The title of the result set a compare run's variants share; each result's `variation` is its variant's label. */
export const comparisonSetTitle = "Comparison";

/** A variant's letter by its index: A, B, C… */
export const letter = (index: number) => String.fromCharCode(65 + index);

export type ComparisonRating = "liked" | "disliked";
