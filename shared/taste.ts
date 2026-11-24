/** The longest taste profile summary Studio writes, in characters. */
export const maxTasteSummary = 1000;
/** The longest word or tag a taste field holds, in characters. */
export const maxTastePhrase = 80;
/** The longest rule, in characters. */
export const maxTasteRule = 160;

/**
 * A taste profile's fields: words the summariser writes (likes, dislikes as `avoid`, styles and
 * the note) and favourites read from scores (model profile ids, LoRA names, shapes as
 * width-over-height ratios such as "0.67", caption tags). A field the person edits is theirs, and
 * Studio's learning leaves it alone until they hand it back. Rules are the person's alone: limits
 * every prompt written for them keeps ("never fat: always a clear waist"), never a look to aim for.
 */
export interface TasteFields {
  likes: string[];
  avoid: string[];
  exclusions: string[];
  styles: string[];
  note: string;
  rules: string[];
  models: string[];
  loras: string[];
  shapes: string[];
  tags: string[];
}
export type TasteWords = Pick<TasteFields, "likes" | "avoid" | "styles" | "note">;
export const tasteLimits = {
  likes: 12,
  avoid: 40,
  exclusions: 40,
  styles: 8,
  note: 400,
  rules: 12,
  models: 8,
  loras: 8,
  shapes: 6,
  tags: 12,
} as const;
export type TastePreferences = Partial<TasteFields>;
export type TastePreferenceChanges = { [Key in keyof TasteFields]?: TasteFields[Key] | null };

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
/** The common shapes, portrait to landscape. */
export const commonShapes = shapes.map(([w, h]) => shapeOf(w / h)).sort((a, b) => +a - +b);
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
