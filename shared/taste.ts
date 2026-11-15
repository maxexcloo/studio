/** The longest taste profile summary Studio writes, in characters. */
export const maxTasteSummary = 1000;
/** The most avoids a person adds to their taste profile, and the longest one, in characters. */
export const maxAvoids = 30;
export const maxAvoid = 80;

/** Words inferred from feedback, with explicit edits kept separately. */
export interface TasteWords {
  likes: string[];
  styles: string[];
  avoid: string[];
  note: string;
}
export const tasteWordLimits = { likes: 12, styles: 8, avoid: 8, note: 400 } as const;
export type TastePreferences = Partial<TasteWords>;
export type TastePreferenceChanges = { [Key in keyof TasteWords]?: TasteWords[Key] | null };
