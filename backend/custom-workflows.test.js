import assert from "node:assert/strict";
import test from "node:test";
import { graphFromJson, metadataFromJson } from "./custom-workflows.js";

test("visual workflow conversion prefers named widgets and ignores UI-only widget values", () => {
  const raw = {
    nodes: [
      {
        id: 373,
        type: "KSampler",
        inputs: [],
        widgets_values: [123, "randomize", 2, 1, "euler", "simple", 1],
        widgets_values_named: {
          seed: 123,
          control_after_generate: "randomize",
          steps: 2,
          cfg: 1,
          sampler_name: "euler",
          scheduler: "simple",
          denoise: 1,
        },
      },
    ],
    links: [],
  };
  const info = {
    KSampler: {
      input: {
        required: {
          seed: ["INT"],
          steps: ["INT"],
          cfg: ["FLOAT"],
          sampler_name: [["euler"]],
          scheduler: [["simple"]],
          denoise: ["FLOAT"],
        },
      },
    },
  };
  assert.deepEqual(graphFromJson(raw, info)["373"].inputs, {
    seed: 123,
    steps: 2,
    cfg: 1,
    sampler_name: "euler",
    scheduler: "simple",
    denoise: 1,
  });
});

test("start image metadata is normalized into a media input", () => {
  const workflow = metadataFromJson({
    studio: {
      id: "legacy-edit",
      controls: {
        prompt: { node: "2", input: "prompt" },
        startImage: { node: "1", input: "image" },
      },
      capabilities: { startImageRequired: true },
    },
    1: { class_type: "LoadImage", inputs: { image: "example.png" } },
    2: { class_type: "TextEncodeQwenImageEditPlus", inputs: { prompt: "", image1: ["1", 0] } },
    3: { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "test" } },
  });
  assert.equal(workflow.capabilities.imageToImage, true);
  assert.equal(workflow.capabilities.startImageRequired, true);
  assert.deepEqual(workflow.mediaInputs[0].control, { node: "1", input: "image" });
});

test("custom filename mappings expose one-image capacity without rewriting the saved declaration", () => {
  const raw = {
    studio: {
      id: "single-filename",
      mediaInputs: [
        { id: "reference", label: "Style", max: 8, control: { node: "1", input: "image" } },
      ],
    },
    graph: { 1: { class_type: "LoadImage", inputs: { image: "original.png" } } },
  };
  const workflow = metadataFromJson(raw);
  assert.equal(workflow.mediaInputs[0].max, 1);
  assert.match(workflow.metadataWarnings[0], /Style maps one image filename/);
  assert.equal(raw.studio.mediaInputs[0].max, 8);
  assert.equal(raw.graph[1].inputs.image, "original.png");
});

test("prepared recipe metadata preserves conditioning and exact adapter identities", () => {
  const recipe = {
    modelLabel: "MiniMax H3",
    conditioning: "Ref2VA",
    label: "PDD · 8-Step",
    adapters: ["ref-adapter.safetensors"],
  };
  const workflow = metadataFromJson(
    { studio: { id: "ref-pdd", recipe }, graph: {} },
    "recipe.json",
  );
  assert.deepEqual(workflow.recipe, recipe);
  assert.equal(workflow.profileId, "custom:ref-pdd");
});

test("profile-owned prompting metadata preserves structured guidance and only explicit mode overrides", () => {
  const prompting = {
    id: "researched-guide",
    summary: "Fixture guidance",
    rules: ["Keep the subject"],
    patterns: { subject: "A subject", setting: "A setting" },
    reviewed_on: "2026-10-16",
    extension: { future: true },
  };
  const reference = { ...prompting, summary: "Preserve the reference subject" };
  const raw = {
    graph: {},
    studio: {
      id: "prompting-metadata",
      prompting,
      imageModes: { generate: {}, reference: { prompting: reference } },
    },
  };
  const workflow = metadataFromJson(raw);
  assert.deepEqual(workflow.prompting, prompting);
  assert.equal(workflow.imageModes.generate.prompting, undefined);
  assert.deepEqual(workflow.imageModes.reference.prompting, reference);
  workflow.prompting.rules[0] = "A local edit";
  assert.equal(raw.studio.prompting.rules[0], "Keep the subject");
});

test("a synced profile's numbered reference slots chain into one stack", async () => {
  // A real FLUX.3 [klein] Base profile: ten "Reference Image" slots, none saying they belong together.
  const { readFile } = await import("node:fs/promises");
  const raw = JSON.parse(
    await readFile(
      new URL("./fixtures/profiles/flux3-klein-base-10-references.json", import.meta.url),
      "utf8",
    ),
  );
  const workflow = metadataFromJson(raw);
  assert.equal(workflow.mediaInputs.length, 10);
  assert.equal(workflow.mediaInputs[0].follows, undefined);
  workflow.mediaInputs
    .slice(1)
    .forEach((input, index) => assert.equal(input.follows, workflow.mediaInputs[index].id));
});

test("start and end frames and differently named slots stay separate", () => {
  const slot = (id, label, role) => ({
    id,
    kind: "image",
    label,
    ...(role ? { role } : {}),
    control: { node: "1", input: id },
  });
  const workflow = metadataFromJson({
    studio: {
      id: "frames",
      controls: { prompt: { node: "2", input: "prompt" } },
      mediaInputs: [
        slot("start", "Start Frame", "start"),
        slot("end", "End Frame", "end"),
        slot("style", "Style Image"),
        slot("subject", "Subject Image"),
      ],
    },
    1: { class_type: "LoadImage", inputs: { image: "a.png" } },
    2: { class_type: "CLIPTextEncode", inputs: { text: "" } },
    3: { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "t" } },
  });
  assert.deepEqual(
    workflow.mediaInputs.map((input) => input.follows),
    [undefined, undefined, undefined, undefined],
  );
  assert.deepEqual(
    workflow.mediaInputs.slice(0, 2).map((input) => input.role),
    ["start", "end"],
  );
});

test("the nsfw marker reaches the profile only when it is true", () => {
  assert.equal(
    metadataFromJson({ studio: { id: "spicy", nsfw: true }, graph: {} }, "spicy.json").nsfw,
    true,
  );
  assert.equal(
    "nsfw" in metadataFromJson({ studio: { id: "plain", nsfw: "yes" }, graph: {} }, "plain.json"),
    false,
  );
});
