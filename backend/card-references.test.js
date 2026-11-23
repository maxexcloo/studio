import assert from "node:assert/strict";
import test from "node:test";

import { referenceCandidates, referencePrompt } from "../shared/characters.ts";
import { findDirectRoute } from "./domain/direct-route.ts";
import { temporaryFolder } from "./fixtures/temporary.js";

process.env.STUDIO_DATA_DIR = temporaryFolder("studio-card-references-");
const { registerCardReferenceRoutes } = await import("./card-references.js");
const { addPickedReference, cardOf, listCards } = await import("./cards.js");

test("each card kind draws its references plainly from its description", () => {
  assert.match(
    referencePrompt("characters", "red-haired woman in her thirties, freckles."),
    /^Full-body reference photo of red-haired woman in her thirties, freckles, .*plain light gray studio background/,
  );
  // An outfit comes without a face, and a scene without people.
  assert.match(
    referencePrompt("outfits", "yellow raincoat, black rubber boots"),
    /on a mannequin: yellow raincoat, black rubber boots\. The whole outfit in view, footwear included/,
  );
  assert.equal(
    referencePrompt("scenes", " rainy city street at night "),
    "Wide establishing shot of rainy city street at night, empty of people, natural light, sharp focus.",
  );
});

test("Generate References saves a new character waiting on its candidates, whose pick becomes its image", async () => {
  const app = {};
  const queued = [];
  registerCardReferenceRoutes(app, {
    profiles: async () => [
      { id: "radiance", kind: "image", model: "m", workflow: "w", defaults: { steps: 8 } },
      { id: "stopped", kind: "image", ready: false },
    ],
    queue: async (_account, body) => {
      queued.push(body);
      return {
        status: 201,
        payload: {
          id: "compare-1",
          variants: body.variants.map((variant, index) => ({ jobId: `job-${index}` })),
        },
      };
    },
  });
  const run = (body) =>
    findDirectRoute(app, "POST", "/api/characters/references").run(
      { userId: "artist", authenticated: true, features: { characters: true } },
      { params: {}, query: {}, body },
    );
  const mara = { name: "Mara", description: "red-haired ranger", referenceIds: [] };
  // Only a ready image model the account may use draws them, and nothing is saved or queued else.
  assert.equal((await run({ ...mara, profileId: "stopped" })).status, 400);
  assert.equal((await run({ ...mara, description: "", profileId: "radiance" })).status, 400);
  assert.equal(queued.length + listCards("characters", "artist").length, 0);
  const made = await run({ ...mara, profileId: "radiance" });
  assert.equal(made.status, 201, JSON.stringify(made.payload));
  const [{ variants }] = queued;
  assert.equal(variants.length, referenceCandidates);
  assert.equal(new Set(variants.map(({ input }) => input.seed)).size, referenceCandidates);
  assert.deepEqual(
    [variants[0].input.profileId, variants[0].input.steps, variants[0].input.prompt],
    ["radiance", 8, referencePrompt("characters", "red-haired ranger")],
  );
  assert.equal(made.payload.character.candidates, "compare-1");
  assert.deepEqual(made.payload.character.references, []);
  // The pick joins its images, once; another account's pick of the same id changes nothing.
  addPickedReference("other", "compare-1", "theirs");
  addPickedReference("artist", "compare-1", "pick-1");
  addPickedReference("artist", "compare-1", "pick-1");
  assert.deepEqual(cardOf("artist", "compare-1").card.referenceIds, ["pick-1"]);
  assert.equal(cardOf("other", "compare-1"), undefined);
});
