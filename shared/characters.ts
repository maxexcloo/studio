import { guidingRoles, isCloudProfile } from "./profiles.ts";

/**
 * Cards an account keeps to shoot a series (backend/cards.js stores them per account, one document
 * per kind): a character (1–4 reference images and its lasting looks), an outfit and a scene (a
 * description, with at most one image to recognise it by, which goes to a model only behind
 * `STUDIO_CARD_IMAGES`: cardImageSlots).
 */
export const maxCharacterImages = 4;
export const maxCardName = 60;
// Long enough for a detailed character, such as an owner's ~600-character body and face.
export const maxCardDescription = 1000;
export const maxCards = 200;
/** How much backstory or scene notes an MCP chat's context keeps for Studio's prompt writers. */
export const maxContextNotes = 2000;
export const cardKinds = {
  characters: { name: "character", prefix: "chr", images: { min: 1, max: maxCharacterImages } },
  outfits: { name: "outfit", prefix: "out", images: { min: 0, max: 1 } },
  scenes: { name: "scene", prefix: "scn", images: { min: 0, max: 1 } },
} as const;
export type CardKind = keyof typeof cardKinds;
/**
 * How many of a card's images a draft places: its first. The run adds the others after it where the
 * profile's reference stack has room (backend/character-sheets.js sheetReferences).
 */
export const characterImages = 1;

export interface Card {
  id: string;
  name: string;
  description: string;
  /** Account-owned reference asset IDs (backend/references.js), in slot order. */
  referenceIds: string[];
  createdAt: string;
  updatedAt: string;
}
/**
 * A character's own story beside its looks: shown on its card and never sent to a model, which
 * draws only the description. Ages start at 18.
 */
export const characterTraits = ["job", "backstory", "likes", "dislikes"] as const;
export type CharacterTrait = (typeof characterTraits)[number];
export const maxCharacterTrait = 500;
export const minCharacterAge = 18;
export const maxCharacterAge = 120;
/** How many characters one create_characters call makes (backend/mcp/generate.js). */
export const maxNewCharacters = 4;
export interface Character extends Card, Partial<Record<CharacterTrait, string>> {
  age?: number;
  /** The portrait an MCP chat queued for a new card, until it becomes the card's first image. */
  portrait?: { jobId: string; sheet?: boolean };
  /** Make Sheet's job, then its panels once backend/character-sheets.js has split them. */
  sheet?: CharacterSheet;
}

/**
 * Make Sheet: a character design sheet, the card's first image redrawn as a neutral face, front,
 * side and back views, empty-handed (backend/character-sheets.js). Each panel is kept as an image of
 * the card by its role, and `sheet` is the whole sheet.
 */
export const sheetRoles = ["face", "front", "side", "back", "sheet"] as const;
export type SheetRole = (typeof sheetRoles)[number];
export interface CharacterSheet {
  jobId: string;
  at: string;
  /** Account-owned reference asset IDs by role, once the sheet is split. */
  panels?: { role: SheetRole; referenceId: string }[];
  error?: string;
}

/**
 * The sheet view a prompt asks for, if it names one: a back view, a side view, a close-up of the
 * face or a full-body front view.
 */
export function sheetView(prompt: string): SheetRole | undefined {
  const text = prompt.toLowerCase();
  if (/\b(from behind|back view|rear view|facing away|seen from the back)\b/.test(text))
    return "back";
  if (/\b(side view|in profile|profile view|from the side|side-on)\b/.test(text)) return "side";
  if (/\b(close-up|closeup|headshot|head-and-shoulders|head and shoulders)\b/.test(text))
    return "face";
  if (/\b(full-body|full body|front view|from head to toe)\b/.test(text)) return "front";
}

/**
 * The image of a character a prompt is drawn from: the sheet's panel for the view the prompt
 * names (sheetView), else the card's first image.
 */
export function characterImage(
  card: Pick<Character, "referenceIds" | "sheet">,
  prompt: string,
): string | undefined {
  const view = sheetView(prompt);
  return (
    card.sheet?.panels?.find((panel) => panel.role === view)?.referenceId || card.referenceIds[0]
  );
}

/**
 * The images of a character Studio sends to a model, its first and its sheet's: any of them in a
 * run means the character.
 */
export const characterImageIds = (card: Pick<Character, "referenceIds" | "sheet">) => [
  ...card.referenceIds.slice(0, characterImages),
  ...(card.sheet?.panels || []).map((panel) => panel.referenceId),
];

/**
 * Whether a video profile animates subjects from its references rather than from a first frame,
 * such as MiniMax H3's Reference profiles: a character's sheet goes there whole.
 */
export const takesSubjects = (profile: {
  kind?: string;
  editReferences?: boolean;
  mediaInputs?: { id: string; role?: string }[];
}) =>
  profile.kind === "video" &&
  profile.editReferences === true &&
  Boolean(profile.mediaInputs?.length) &&
  !profile.mediaInputs!.some((slot) => slot.role === "start" || slot.role === "end");

/**
 * Whether a profile keeps a character's identity in new scenes: it edits with its references (a
 * cloud model, or a family such as Qwen-Image, FLUX.2 or MOSS). Elsewhere a reference is an img2img
 * start image whose pose and layout carry over.
 */
export const editsReferences = (profile: {
  id?: string;
  family?: string;
  provider?: string;
  editReferences?: boolean;
}) => profile.editReferences === true || isCloudProfile(profile);

/** A profile's Identity slot (shared/profiles.ts), such as PuLID's face input: where a character's image goes. */
export const identitySlot = (profile: { mediaInputs?: { id: string; role?: string }[] }) =>
  profile.mediaInputs?.find((input) => input.role === "identity")?.id;

/** Whether a character's image keeps its face on a profile: it edits with it or has an Identity slot. */
export const keepsIdentity = (
  profile: Parameters<typeof editsReferences>[0] & {
    mediaInputs?: { id: string; role?: string }[];
  },
) => Boolean(profile.mediaInputs?.length && (editsReferences(profile) || identitySlot(profile)));

/** Characters go to these first: a family that keeps them, or a profile with an Identity slot. */
export const keepsCharacterFaces = (profile: {
  keepsCharacters?: boolean;
  mediaInputs?: { id: string; role?: string }[];
}) => profile.keepsCharacters === true || Boolean(identitySlot(profile));

/**
 * The reference slot a profile's result is drawn from (img2img), if any: its start slot (else its
 * first) on a profile that doesn't edit with its references, unless that slot only guides
 * (Identity, Pose/Layout or Style, shared/profiles.ts).
 */
export function startImageSlot(profile: {
  id?: string;
  family?: string;
  provider?: string;
  editReferences?: boolean;
  mediaInputs?: { id: string; role?: string }[];
}) {
  const slots = profile.mediaInputs || [];
  const slot = slots.find((input) => input.role === "start") || slots[0];
  if (!slot || editsReferences(profile) || Object.hasOwn(guidingRoles, slot.role || "")) return;
  return slot.id;
}

/**
 * The profiles a character goes to, best first: those that keep a face, hair and build across new
 * outfits and scenes (a family with the catalogue's `keepsCharacters`, or an Identity slot such as
 * PuLID's), then any other that edits with references; `preferred` ids lead within each. Never an
 * img2img-only profile.
 */
export function characterProfiles<
  P extends {
    id: string;
    family?: string;
    provider?: string;
    editReferences?: boolean;
    keepsCharacters?: boolean;
    mediaInputs?: { id: string; role?: string }[];
  },
>(profiles: P[], preferred: (string | undefined)[] = []) {
  const rank = (profile: P) => {
    const at = preferred.indexOf(profile.id);
    return (keepsCharacterFaces(profile) ? 0 : 1000) + (at < 0 ? 999 : at);
  };
  return profiles.filter(keepsIdentity).sort((left, right) => rank(left) - rank(right));
}

/**
 * What leads a prompt for a character, with the card's description verbatim: the reference image
 * names the person and the description adds lasting looks, so the prompt after it only sets the
 * outfit and scene, naming its `images` in the plural when the run sends several. Without the
 * image (`fromImage` false) the description alone leads.
 */
export function characterLead(description: string, fromImage = true, images = 1) {
  const looks = description.trim().replace(/[\s.,;:]+$/, "");
  if (!fromImage) return looks && `${looks}.`;
  return `The person from the reference image${images > 1 ? "s" : ""}${looks ? `, ${looks},` : ""} with the same face, hair and build.`;
}

/** The prompt led by a card's identity (characterLead), unless it already holds it. */
export function withCharacter(prompt: string, description: string, fromImage = true) {
  const lead = characterLead(description, fromImage);
  if (!lead || prompt.includes(lead)) return prompt;
  const rest = prompt.trimStart();
  return rest ? `${lead} ${rest}` : lead;
}

/** The prompt without a card's lead and the space that joined it. */
export const withoutCharacter = (prompt: string, description: string) =>
  withoutPart(prompt, characterLead(description));

const sentence = (text = "") => {
  const words = text.trim().replace(/[\s.,;:]+$/, "");
  return words && `${words[0].toUpperCase()}${words.slice(1)}.`;
};
/** What the person wears, as written; an outfit names its footwear, or the reference's carries over. */
export const outfitPart = (outfit = "") =>
  outfit.trim() ? `The person wears ${outfit.trim().replace(/[\s.,;:]+$/, "")}.` : "";
/** The place, which with a character's image replaces that image's own background. */
export function scenePart(scene = "", withImage = false) {
  const place = sentence(scene);
  return place && withImage
    ? `${place.slice(0, -1)}, in place of the reference image's background.`
    : place;
}
/**
 * The slots an outfit card's and a scene card's images go to beside a character's (MCP generate's
 * shots, behind `STUDIO_CARD_IMAGES` until proven on live), given the slots already `taken`: an
 * outfit a Style slot, a scene a Pose/Layout slot, else each the next plain slot on a profile that
 * edits with its references, outfit first. Never an Identity, start or end slot, nor a plain slot on
 * an img2img profile, where the image would be what the result is drawn from. A card left without
 * a slot stays words only (cardImageNote).
 */
export function cardImageSlots(
  profile: Parameters<typeof editsReferences>[0] & {
    mediaInputs?: { id: string; role?: string }[];
  },
  taken: string[],
  wanted: { outfit?: boolean; scene?: boolean },
) {
  const free = (profile.mediaInputs || []).filter((slot) => !taken.includes(slot.id));
  const plain = editsReferences(profile)
    ? free.filter((slot) => !slot.role || slot.role === "reference")
    : [];
  const roleSlot = (role: string) => free.find((slot) => slot.role === role)?.id;
  const outfit = wanted.outfit ? roleSlot("style") || plain.shift()?.id : undefined;
  const scene = wanted.scene ? roleSlot("layout") || plain.shift()?.id : undefined;
  return {
    ...(outfit ? { outfit } : {}),
    ...(scene ? { scene } : {}),
  };
}

/** What a reply says of a card whose image found no slot (cardImageSlots). */
export const cardImageNote = (kind: "Outfit" | "Scene", references: number) =>
  `${kind} described in words; this model takes ${references} reference${references === 1 ? "" : "s"}.`;

/**
 * A shot composed from its parts, in the order and wording that held a character across ten outfits
 * and scenes on live (10 Nov): the character's lead (characterLead, with its image unless
 * `fromImage` is false), what the person wears (outfitPart), the scene (scenePart), then the action
 * and the camera.
 */
export function composePrompt({
  character,
  outfit,
  scene,
  action,
  camera,
  fromImage = true,
}: {
  character?: string;
  outfit?: string;
  scene?: string;
  action?: string;
  camera?: string;
  fromImage?: boolean;
}) {
  return [
    character === undefined ? "" : characterLead(character, fromImage),
    outfitPart(outfit),
    scenePart(scene, character !== undefined && fromImage),
    sentence(action),
    sentence(camera),
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The prompt with `part` (an outfit's or scene's sentence) placed after the last of `after` it holds
 * (the parts that come first: a character's lead, an outfit), else at the start; unchanged when it
 * already holds it.
 */
export function withPart(prompt: string, part: string, after: string[] = []) {
  if (!part || prompt.includes(part)) return prompt;
  const at = Math.max(
    0,
    ...after.filter(Boolean).map((text) => {
      const found = prompt.indexOf(text);
      return found < 0 ? 0 : found + text.length;
    }),
  );
  const before = prompt.slice(0, at).trimEnd();
  const rest = prompt.slice(at).trimStart();
  return [before, part, rest].filter(Boolean).join(" ");
}

/** The prompt without `part` and the space that joined it. */
export function withoutPart(prompt: string, part: string) {
  const at = part ? prompt.indexOf(part) : -1;
  if (at < 0) return prompt;
  const before = prompt.slice(0, at).trimEnd();
  const after = prompt.slice(at + part.length).trimStart();
  return before && after ? `${before} ${after}` : before || after;
}
