/** The longest word or tag a taste field holds, in characters. */
export const maxTastePhrase = 80;
/** The longest rule an issue suggests, in characters. */
export const maxTasteRule = 160;
/** The longest My Preferences text, in characters. */
export const maxTastePrefer = 2000;
/** The longest guidance one area of taste holds, in characters. */
export const maxTasteGuidance = 300;

/**
 * What Studio learnt of a person's taste: words the summariser writes (likes, what it leans away
 * from as `avoid`, styles and the note) and favourites read from scores (model profile ids, LoRA
 * names, shapes as width-over-height ratios such as "0.67", caption tags). Only learning changes
 * them; the person steers it by adding values to Favourites, Less Of and Exclusions.
 */
export interface TasteFields {
  likes: string[];
  avoid: string[];
  styles: string[];
  note: string;
  models: string[];
  loras: string[];
  shapes: string[];
  tags: string[];
}
export type TasteWords = Pick<TasteFields, "likes" | "avoid" | "styles" | "note">;
/** What Favourites and Less Of mark: learnt words (likes, styles) or a model, LoRA, shape or tag. */
export const tasteMarkKinds = ["words", "models", "loras", "shapes", "tags"] as const;
export type TasteMarkKind = (typeof tasteMarkKinds)[number];
export type TasteMarks = Partial<Record<TasteMarkKind, string[]>>;
/**
 * The person's own taste: My Preferences (`prefer`, free text), Favourites, Less Of (a soft
 * down-weight) and Exclusions (hard, everywhere).
 */
export interface TastePreferences {
  prefer?: string;
  favourites?: TasteMarks;
  less?: TasteMarks;
  exclusions?: string[];
}
export type TastePreferenceChanges = {
  [Key in keyof TastePreferences]?: TastePreferences[Key] | null;
};
export const tasteLimits = {
  likes: 12,
  avoid: 8,
  exclusions: 40,
  styles: 8,
  note: 400,
  words: 12,
  models: 8,
  loras: 8,
  shapes: 6,
  tags: 12,
} as const;

/** Where taste applies (Settings › Taste), each area with its own switch and guidance. */
export const tasteAreas = ["dream", "suggestions", "writing", "chats"] as const;
export type TasteArea = (typeof tasteAreas)[number];
/** Whether an area uses Learnt and My Preferences, and the guidance always sent with its work. */
export interface TasteAreaSetting {
  taste: boolean;
  guidance: string;
}
export type TasteAreas = Record<TasteArea, TasteAreaSetting>;
const tasteAreaDefaults: TasteAreas = {
  dream: { taste: true, guidance: "" },
  suggestions: { taste: true, guidance: "" },
  writing: { taste: false, guidance: "" },
  chats: { taste: false, guidance: "" },
};
/** An account's saved areas (the `tasteAreas` preference) over the defaults. */
export const tasteAreasOf = (saved?: Partial<Record<TasteArea, Partial<TasteAreaSetting>>>) =>
  Object.fromEntries(
    tasteAreas.map((area) => [area, { ...tasteAreaDefaults[area], ...saved?.[area] }]),
  ) as TasteAreas;

const shapes: [number, number][] = [
  [1, 1],
  [4, 5],
  [3, 4],
  [2, 3],
  [9, 16],
  [5, 4],
  [4, 3],
  [3, 2],
  [16, 9],
  [21, 9],
];
/** A width-over-height ratio as a taste shape, to two places. */
export const shapeOf = (ratio: number) => String(Math.round(ratio * 100) / 100);
/** A shape's readable name, such as "Portrait 2:3" or "Square 1:1". */
export function shapeName(shape: string) {
  const ratio = Number(shape);
  // Trained buckets round common shapes, such as 1344 × 768 for 16:9.
  const [near] = shapes
    .filter(([w, h]) => Math.abs(w / h - ratio) < 0.04)
    .sort(([a, b], [c, d]) => Math.abs(a / b - ratio) - Math.abs(c / d - ratio));
  const orientation = ratio > 1.02 ? "Landscape" : ratio < 0.98 ? "Portrait" : "Square";
  return `${orientation} ${near ? `${near[0]}:${near[1]}` : `${shape}:1`}`;
}

/**
 * What a caption tag names, where its words say: clothing first, so "red dress" is an outfit, then
 * places, then colours.
 */
const tagKinds = [
  [
    "outfit",
    /\b(?:apron|armou?r|attire|bikinis?|blazers?|blouses?|boots|bras?|cardigans?|clothing|coats?|corsets?|costumes?|dress(?:es)?|gloves|gowns?|hats?|heels|hoodies?|jackets?|jeans|kimonos?|leggings|leotards?|lingerie|outfits?|pants|robes?|scarf|scarves|shirts?|shorts|skirts?|stockings|suits?|sweaters?|swimsuits?|swimwear|tops?|trousers|underwear|uniforms?|\w*wear)\b/,
  ],
  [
    "scene",
    /\b(?:alley|backstage|bars?|bathroom|beach|bedroom|bridge|cafe|castle|church|city|cityscape|classroom|club|desert|diner|field|forest|garden|gym|harbou?r|hotel|indoors?|interior|kitchen|lake|landscape|library|market|meadow|mountains?|ocean|office|outdoors?|park|pool|restaurant|river|rooftop|room|ruins?|sea|shore|skyline|snow|space|stage|station|street|studio|subway|underwater|woods)\b/,
  ],
  [
    "colour",
    /\b(?:amber|beige|black|blue|brown|burgundy|colou?rful|cream|crimson|cyan|emerald|gold(?:en)?|gr[ae]y|green|ivory|lavender|magenta|maroon|monochrome|navy|neon|olive|orange|pastel|pink|purple|red|scarlet|silver|tan|teal|turquoise|violet|white|yellow)\b/,
  ],
] as const;
export type TagKind = (typeof tagKinds)[number][0];
export const tagKind = (tag: string): TagKind | undefined =>
  tagKinds.find(([, words]) => words.test(tag.toLowerCase()))?.[0];

/** A retained Dream action, with links only to results still available to its owner. */
export interface DreamActivity {
  at: string;
  action: string;
  question?: string;
  answer?: string;
  item: { id?: string; number?: number; title: string; media?: "image" | "video" };
  other?: { id?: string; number?: number; title: string; media?: "image" | "video" };
}
