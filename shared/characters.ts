import { isCloudProfile } from "./profiles.ts";

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

/**
 * The profiles a character goes to, best first: those whose family keeps a face, hair and build
 * across new outfits and scenes (the family catalogue's `keepsCharacters`), then any other that
 * edits with references; `preferred` ids lead within each. Never an img2img-only profile.
 */
export function characterProfiles<
  P extends {
    id: string;
    family?: string;
    provider?: string;
    editReferences?: boolean;
    keepsCharacters?: boolean;
    mediaInputs?: unknown[];
  },
>(profiles: P[], preferred: (string | undefined)[] = []) {
  const rank = (profile: P) => {
    const at = preferred.indexOf(profile.id);
    return (profile.keepsCharacters ? 0 : 1000) + (at < 0 ? 999 : at);
  };
  return profiles
    .filter((profile) => profile.mediaInputs?.length && editsReferences(profile))
    .sort((left, right) => rank(left) - rank(right));
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
export function withoutCharacter(prompt: string, description: string) {
  const lead = characterLead(description);
  const at = prompt.indexOf(lead);
  if (at < 0) return prompt;
  const before = prompt.slice(0, at).trimEnd();
  const after = prompt.slice(at + lead.length).trimStart();
  return before && after ? `${before} ${after}` : before || after;
}

const sentence = (text = "") => {
  const words = text.trim().replace(/[\s.,;:]+$/, "");
  return words && `${words[0].toUpperCase()}${words.slice(1)}.`;
};
/**
 * A shot composed from its parts, in the order and wording that held a character across ten outfits
 * and scenes on live (10 Nov): the character's lead (characterLead, with its image unless
 * `fromImage` is false), what the person wears (an outfit names its footwear, or the reference's
 * shoes or bare feet carry over), the scene, which replaces the reference image's own background,
 * then the action and the camera.
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
  const withImage = character !== undefined && fromImage;
  const place = sentence(scene);
  return [
    character === undefined ? "" : characterLead(character, fromImage),
    outfit?.trim() ? `The person wears ${outfit.trim().replace(/[\s.,;:]+$/, "")}.` : "",
    place && withImage
      ? `${place.slice(0, -1)}, in place of the reference image's background.`
      : place,
    sentence(action),
    sentence(camera),
  ]
    .filter(Boolean)
    .join(" ");
}
