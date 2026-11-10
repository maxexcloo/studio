import { isCloudProfile } from "./profiles.ts";

/**
 * Character cards: a name, 1–4 reference images and a short description of lasting looks that
 * leads the prompt when the card is picked (backend/characters.js stores them per account).
 */
export const maxCharacterImages = 4;
export const maxCharacterName = 60;
export const maxCharacterDescription = 400;
export const maxCharacters = 200;
/**
 * How many of a card's images go to a model: its first. A model that edits with references reads
 * each image as another subject, so three views of one person drew her twice on live, however the
 * prompt said there was one.
 */
export const characterImages = 1;

export interface Character {
  id: string;
  name: string;
  description: string;
  /** Account-owned reference asset IDs (backend/references.js), in slot order. */
  referenceIds: string[];
  createdAt: string;
  updatedAt: string;
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
