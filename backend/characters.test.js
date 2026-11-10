import assert from "node:assert/strict";
import test from "node:test";
import {
  characterLead,
  composePrompt,
  characterProfiles,
  withCharacter,
  withoutCharacter,
} from "../shared/characters.ts";

test("a character's lead starts a prompt once, and removing it restores the prompt", () => {
  const description = "red-haired woman in her thirties, freckles";
  const lead = characterLead(description);
  assert.equal(
    lead,
    "The person from the reference image, red-haired woman in her thirties, freckles, with the same face, hair and build.",
  );
  for (const [prompt, led] of [
    ["", lead],
    ["In a green cloak on a misty forest path", `${lead} In a green cloak on a misty forest path`],
  ]) {
    assert.equal(withCharacter(prompt, description), led);
    assert.equal(withCharacter(led, description), led);
    assert.equal(withoutCharacter(led, description), prompt);
  }
  assert.equal(
    characterLead(""),
    "The person from the reference image with the same face, hair and build.",
  );
});

test("characters go to a family that keeps them, then to other editing models, never img2img", () => {
  const slot = [{ id: "reference" }];
  const profiles = [
    { id: "kromafine", family: "krea2", mediaInputs: slot },
    { id: "klein", family: "flux2_klein_9b", editReferences: true, mediaInputs: slot },
    {
      id: "qwen",
      family: "qwen_image_21",
      editReferences: true,
      keepsCharacters: true,
      mediaInputs: slot,
    },
  ];
  assert.deepEqual(
    characterProfiles(profiles).map((profile) => profile.id),
    ["qwen", "klein"],
  );
  assert.deepEqual(
    characterProfiles(profiles.slice(0, 2), ["kromafine", "klein"]).map((profile) => profile.id),
    ["klein"],
  );
});

test("a shot composes character, outfit, scene, action and camera in the wording proven on live", () => {
  const looks = "woman in her forties, short dark curly hair";
  const parts = {
    outfit: "a yellow raincoat and black rubber boots.",
    scene: "a rainy city street at night",
    action: "walking towards the camera",
    camera: "full-length shot",
  };
  assert.equal(
    composePrompt({ character: looks, ...parts }),
    `${characterLead(looks)} The person wears a yellow raincoat and black rubber boots. A rainy city street at night, in place of the reference image's background. Walking towards the camera. Full-length shot.`,
  );
  // Without the image the description leads alone and the scene has no reference background to replace.
  assert.equal(
    composePrompt({ character: looks, ...parts, fromImage: false }),
    `${looks}. The person wears a yellow raincoat and black rubber boots. A rainy city street at night. Walking towards the camera. Full-length shot.`,
  );
  assert.equal(composePrompt({ scene: "a café", action: "reading" }), "A café. Reading.");
});
