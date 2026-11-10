import assert from "node:assert/strict";
import test from "node:test";
import {
  characterLead,
  composePrompt,
  outfitPart,
  scenePart,
  withPart,
  withoutPart,
  characterProfiles,
  identitySlot,
  startImageSlot,
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
  // An Identity slot (such as PuLID's) keeps the face too, so it joins the families that keep characters.
  const pulid = {
    id: "pulid",
    family: "sdxl",
    mediaInputs: [{ id: "start" }, { id: "face", role: "identity" }],
  };
  assert.deepEqual(
    characterProfiles([...profiles, pulid], ["pulid"]).map((profile) => profile.id),
    ["pulid", "qwen", "klein"],
  );
  assert.equal(identitySlot(pulid), "face");
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

test("an outfit and a scene go in after the character's lead in that order, and come out again", () => {
  const lead = characterLead("red-haired ranger");
  const outfit = outfitPart("a green cloak and leather boots");
  const scene = scenePart("a misty forest at dawn", true);
  // Picked in either order, the prompt reads lead, outfit, scene, then the person's own words.
  const sceneFirst = withPart(`${lead} Walking slowly.`, scene, [lead]);
  assert.equal(withPart(sceneFirst, outfit, [lead]), `${lead} ${outfit} ${scene} Walking slowly.`);
  assert.equal(
    withoutPart(withPart(`${lead} Walking slowly.`, outfit, [lead]), outfit),
    `${lead} Walking slowly.`,
  );
  assert.equal(withPart("Walking slowly.", outfit), `${outfit} Walking slowly.`);
});

test("a reference is the img2img start image only where the profile neither edits with it nor guides by it", () => {
  const slots = [{ id: "image" }, { id: "face", role: "identity" }];
  assert.equal(startImageSlot({ mediaInputs: slots }), "image");
  assert.equal(
    startImageSlot({ mediaInputs: [{ id: "first" }, { id: "go", role: "start" }] }),
    "go",
  );
  assert.equal(startImageSlot({ editReferences: true, mediaInputs: slots }), undefined);
  assert.equal(startImageSlot({ mediaInputs: [{ id: "style", role: "style" }] }), undefined);
  assert.equal(startImageSlot({ mediaInputs: [] }), undefined);
});
