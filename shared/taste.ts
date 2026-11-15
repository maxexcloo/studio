/** The longest taste profile summary Studio writes, in characters. */
export const maxTasteSummary = 1000;
/** The most avoids a person adds to their taste profile, and the longest one, in characters. */
export const maxAvoids = 30;
export const maxAvoid = 80;

/** A retained Dream action, with links only to results still available to its owner. */
export interface DreamActivity {
  at: string;
  action: string;
  question?: string;
  answer?: string;
  item: { id?: string; title: string; media?: "image" | "video" };
  other?: { id?: string; title: string; media?: "image" | "video" };
}
