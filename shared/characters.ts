import { guidingRoles, isCloudProfile } from "./profiles.ts";

/**
 * Cards an account keeps to shoot a series (backend/cards.js stores them per account, one document
 * per kind): a character (1–4 reference images and its lasting looks), an outfit and a scene (a
 * description, with at most one image to recognise it by; only a character's image goes to a model).
 */
export const maxCharacterImages = 4;
export const maxCardName = 60;
// Long enough for a detailed character, such as an owner's ~600-character body and face.
export const maxCardDescription = 1000;
export const maxCards = 200;
export const cardKinds = {
  characters: { name: "character", prefix: "chr", images: { min: 1, max: maxCharacterImages } },
  outfits: { name: "outfit", prefix: "out", images: { min: 0, max: 1 } },
  scenes: { name: "scene", prefix: "scn", images: { min: 0, max: 1 } },
} as const;
export type CardKind = keyof typeof cardKinds;
/**
 * How many of a card's images go to a model: its first. A model that edits with references reads
 * each image as another subject, so three views of one person drew her twice on live, however the
 * prompt said there was one.
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
export interface Character extends Card {
  /** Generate References' queued jobs, until the card is next saved with the ones to keep. */
  generated?: { jobIds: string[]; at: string };
}

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
 * outfit and scene. Without the image (`fromImage` false) the description alone leads.
 */
export function characterLead(description: string, fromImage = true) {
  const looks = description.trim().replace(/[\s.,;:]+$/, "");
  if (!fromImage) return looks && `${looks}.`;
  return `The person from the reference image${looks ? `, ${looks},` : ""} with the same face, hair and build.`;
}

/**
 * Generate References: one shot per view, for a consistent set (a character turnaround) the card
 * can keep up to its limit. They share a seed. With the card's first image as a reference, each
 * view follows its lead; without one, the views come from the description alone.
 */
export const characterViews = [
  "Head-and-shoulders portrait from the front, looking at the camera",
  "Full-body front view, standing straight, arms relaxed",
  "Full-body side view in profile, facing left",
  "Full-body back view, facing away",
] as const;
const backdrop = "plain light grey background, even soft lighting, one person in a single view.";
export const characterShots = (description: string, fromImage: boolean) =>
  characterViews.map((view) =>
    fromImage
      ? `${characterLead(description)} ${view}, ${backdrop}`
      : [view, description.trim(), backdrop].filter(Boolean).join(", "),
  );

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
