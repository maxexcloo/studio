import assert from "node:assert/strict";
import test from "node:test";
import { createFaceCheck, faceThreshold, type FaceReader, type Identity } from "./face-check.ts";

type ShotItem = {
  id: string;
  url: string;
  type: string;
  status: string;
  ownerId: string;
  settings: { referenceAssets: { assetId: string }[] };
  identity?: Identity;
};
/** A unit vector at `angle` radians in a plane, so two vectors' cosine is the angle between them. */
const at = (angle: number) => Float32Array.of(Math.cos(angle), Math.sin(angle));

test("results made with a character are scored against its image, and drift or a second face marks them", async () => {
  const shot = (id: string, assetIds: string[], ownerId = "artist"): ShotItem => ({
    id,
    url: `/media/${id}.png`,
    type: "image",
    status: "done",
    ownerId,
    settings: { referenceAssets: assetIds.map((assetId) => ({ assetId })) },
  });
  const items = [
    shot("same", ["mara-front"]),
    shot("other", ["mara-front", "a-hat"]),
    shot("twice", ["mara-front"]),
    shot("back-view", ["mara-front"]),
    // A sheet view counts too; another of the card's images, no references, or another account
    // are not a character result.
    shot("side-view", ["mara-side-view"]),
    shot("side-only", ["mara-side"]),
    shot("plain", []),
    shot("theirs", ["mara-front"], "someone"),
  ];
  // The angle of each image's face from Mara's, and the faces it holds; null for none.
  const faces: Record<string, { vector: Float32Array; faces: number } | null> = {
    "mara-front": { vector: at(0), faces: 1 },
    same: { vector: at(0.5), faces: 1 },
    other: { vector: at(Math.acos(faceThreshold) + 0.2), faces: 1 },
    twice: { vector: at(0.3), faces: 2 },
    "back-view": null,
  };
  const reader: FaceReader = {
    unavailable: () => "",
    embed: async (bytes) => faces[new TextDecoder().decode(bytes)] ?? null,
  };
  const saved: Record<string, Identity> = {};
  const check = createFaceCheck({
    enabled: () => true,
    faces: reader,
    idle: () => true,
    items: () => items,
    visible: () => true,
    characters: (ownerId) =>
      ownerId === "artist"
        ? [{ id: "chr-mara", referenceIds: ["mara-front", "mara-side-view"] }]
        : [],
    image: async (item) => new TextEncoder().encode(item.id),
    reference: async (_ownerId, assetId) => new TextEncoder().encode(assetId),
    save: (item, identity) => {
      item.identity = identity;
      saved[item.id!] = identity;
    },
    load: () => null,
    persist: () => {},
    now: () => Date.parse("2026-11-10T00:00:00Z"),
    log: { info: () => {} },
  });
  check.startPass("missing");
  await check.settled();
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(saved).map(([id, { characterId, score, faces, drifted }]) => [
        id,
        [characterId, score, faces, drifted],
      ]),
    ),
    {
      same: ["chr-mara", Math.round(Math.cos(0.5) * 1000) / 1000, 1, false],
      other: [
        "chr-mara",
        Math.round(Math.cos(Math.acos(faceThreshold) + 0.2) * 1000) / 1000,
        1,
        true,
      ],
      twice: ["chr-mara", Math.round(Math.cos(0.3) * 1000) / 1000, 2, true],
      "back-view": ["chr-mara", null, 0, false],
      "side-view": ["chr-mara", null, 0, false],
    },
  );
});
