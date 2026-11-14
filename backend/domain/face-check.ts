import { createIdleWork, pictured, type IdleDocument, type IdleItem } from "./idle-work.ts";

/**
 * Below this cosine similarity of AuraFace vectors a result's face counts as someone else. On
 * live (10 Nov) one character's results on models that keep faces scored 0.44–0.83 against its
 * image, img2img and MOSS drift 0.16–0.50, and another person 0.03–0.17; profiles and close-ups
 * score lowest of the good ones.
 */
export const faceThreshold = 0.4;

/** What the check stores on a result made with a character (the gallery item's `identity`). */
export interface Identity {
  characterId: string;
  /** Cosine similarity of the result's face to the character's image, or null without a face. */
  score: number | null;
  /** Faces the result holds: more than one usually means the character was drawn twice. */
  faces: number;
  drifted: boolean;
  checkedAt: string;
}

/** A face's unit vector and the faces in its image (providers/faces.ts). */
export interface FaceReader {
  unavailable(): string;
  embed(bytes: Uint8Array): Promise<{ vector: Float32Array; faces: number } | null>;
}

type Item = IdleItem & {
  ownerId?: string;
  identity?: Identity;
  settings?: { referenceAssets?: { assetId?: string }[] };
};

/**
 * The face check: each image made with a character's image (its first or a sheet view among the
 * job's references) is compared with the card's first image, and its `identity` saved, drifted
 * when the face is someone else's or the character appears twice.
 */
export function createFaceCheck(options: {
  enabled(): boolean;
  faces: FaceReader;
  idle(): boolean;
  items(): Iterable<Item>;
  changes?(): number;
  visible(item: Item): boolean;
  /**
   * The owner's character cards: id and the image IDs Studio sends, its first image first
   * (shared/characters.ts characterImageIds). A result made with any of them is compared with the first.
   */
  characters(ownerId: string): { id: string; referenceIds: string[] }[];
  image(item: Item): Promise<Uint8Array>;
  reference(ownerId: string, assetId: string): Promise<Uint8Array>;
  save(item: Item, identity: Identity): void;
  load(): IdleDocument | null;
  persist(document: IdleDocument): void;
  now?: () => number;
  log?: { info(message: string): void };
}) {
  const { faces, now = Date.now } = options;
  const character = (item: Item) => {
    const used = new Set((item.settings?.referenceAssets || []).map((asset) => asset.assetId));
    if (!used.size) return undefined;
    return options
      .characters(item.ownerId || "")
      .find((card) => card.referenceIds.some((id) => used.has(id)));
  };
  // A character's image vector, kept by its asset: one image serves its every result.
  const references = new Map<string, Promise<Float32Array | null>>();
  const referenceVector = (ownerId: string, assetId: string) => {
    const key = `${ownerId}\n${assetId}`;
    let vector = references.get(key);
    if (!vector) {
      vector = options
        .reference(ownerId, assetId)
        .then(async (bytes) => (await faces.embed(bytes))?.vector || null);
      vector.catch(() => references.delete(key));
      references.set(key, vector);
    }
    return vector;
  };
  return createIdleWork<Item>({
    ...options,
    name: "Face check",
    off: "Face Check is off.",
    allowed: () => true,
    unavailable: async () => faces.unavailable(),
    // Unchecked; in a pass also checked against another card (Out of Date) or before it (All).
    wanted(item, _all, target) {
      const card = character(item);
      if (!pictured(item) || !card) return false;
      const { identity } = item;
      if (!identity) return true;
      if (target?.scope === "all") return identity.checkedAt < target.startedAt;
      return target?.scope === "outdated" && identity.characterId !== card.id;
    },
    async run(item) {
      const card = character(item)!;
      const [reference, result] = await Promise.all([
        referenceVector(item.ownerId || "", card.referenceIds[0]),
        options.image(item).then((bytes) => faces.embed(bytes)),
      ]);
      // A character image without a face (a creature, a back view) can't be checked against.
      if (!reference) throw new Error("The character's image shows no face.");
      let score: number | null = null;
      if (result) {
        score = 0;
        for (let index = 0; index < reference.length; index += 1)
          score += reference[index] * result.vector[index];
      }
      const count = result?.faces || 0;
      options.save(item, {
        characterId: card.id,
        score: score === null ? null : Math.round(score * 1000) / 1000,
        faces: count,
        // No face (a back view) is not drift; a second one is the character drawn twice.
        drifted: (score !== null && score < faceThreshold) || count > 1,
        checkedAt: new Date(now()).toISOString(),
      });
    },
  });
}
