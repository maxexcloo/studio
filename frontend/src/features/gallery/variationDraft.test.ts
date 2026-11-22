import assert from "node:assert/strict";
import test from "node:test";

import { characterLead } from "../../../../shared/characters.ts";
import { variationDirections } from "../../../../shared/suggestions.ts";
import type { GenerationInput, Profile } from "../../types";
import { variationVariants } from "./variationDraft.ts";

test("keeps identity wording, references and seed while freeing each direction's guide", () => {
  const text = characterLead("Rae with short black hair and brown eyes");
  const references = [
    { id: "identity-asset", slot: "face", strength: 0.7 },
    { id: "scene-asset", slot: "where", strength: 0.4 },
    { id: "style-asset", slot: "look" },
  ].map((asset) => ({ ...asset, name: asset.id, thumbnailUrl: "", width: 100, height: 100 }));
  const input: GenerationInput = {
    kind: "image",
    profileId: "custom:identity",
    prompt: `${text} Waiting at a harbour.`,
    negative: "",
    width: 1024,
    height: 768,
    steps: 20,
    cfg: 5,
    seed: "",
    count: 1,
    denoise: 0.65,
    fps: 24,
    frames: 81,
    loras: [],
    referenceAssets: references.map(({ id, slot }) => ({ assetId: id, slot })),
    cardParts: {
      rae: { kind: "characters", text, ownsText: true, cardReferenceIds: ["identity-asset"] },
    },
  };
  const profile = {
    defaults: {},
    mediaInputs: [
      { id: "face", role: "identity" },
      { id: "where", role: "layout" },
      { id: "look", role: "style" },
    ],
  } as Profile;
  const variants = variationVariants(
    { input, references, sessionId: "source-session", operation: "image", parentItemId: "source" },
    profile,
    0,
    {},
    [],
    variationDirections.map((request) => ({
      request,
      label: `New ${request}`,
      prompt: `A variation of the ${request}.`,
      action: "recreate",
    })),
  );
  assert.deepEqual(
    variants.map((variant) => variant.input.referenceAssets.map(({ assetId }) => assetId)),
    [
      ["identity-asset", "style-asset"],
      ["identity-asset", "scene-asset"],
      ["identity-asset", "scene-asset"],
    ],
  );
  for (const variant of variants) {
    assert.match(
      variant.input.prompt,
      /^The person from the reference image, Rae with short black hair/,
    );
    assert.equal(variant.input.seed, 0);
    assert.deepEqual(variant.input.cardParts, input.cardParts);
    assert.equal(variant.input.referenceAssets[0].strength, 0.7);
  }
});
