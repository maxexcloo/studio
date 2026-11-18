import assert from "node:assert/strict";
import test from "node:test";

import { resolutionSize } from "../shared/resolution.ts";
import "./fixtures/sample-profiles.js";
import { frameSize } from "./animate-profile.js";
import { saveImportedWorkflow } from "./custom-workflows.js";
import { createGenerationSubmission } from "./generation-routes.js";
import { customWorkflowGraph } from "./graphs.js";
import { mcpSize } from "./mcp/controls.js";
import {
  inferModels,
  sizedRange,
  workflowFamilyStep,
  workflowFamilyValue,
} from "./model/models.js";
import { imageRequest, radianceInfo, videoRequest } from "./providers/radiance.ts";
import { sanitizeGenerateBody } from "./validation.js";

process.env.STUDIO_WORKERS = JSON.stringify([
  {
    id: "radiance",
    url: "http://127.0.0.1:1",
    backend: "radiance",
    capabilities: ["image", "video"],
  },
]);

test("imported workflows take their model family's size step, so off-step sizes are never sent", () => {
  // The Bento Qwen Image 2.1 workflow: its latent node accepts multiples of 8, the model needs 32.
  const qwen = {
    family: "custom",
    graph: {
      1: {
        class_type: "UNETLoader",
        inputs: { unet_name: "qwen_image_2.1_int8_convrot.safetensors" },
      },
    },
  };
  assert.equal(workflowFamilyStep(qwen), 32);
  const range = sizedRange(
    { default: 2048, min: 16, max: 16384, step: 8 },
    workflowFamilyStep(qwen),
  );
  assert.deepEqual([range.step, range.min, range.default], [32, 32, 2048]);
  // 1536 × 9:16 rounded to 32 instead of 8: 2720, not the 2728 that came out mangled.
  assert.equal((Math.round((1536 * 16) / 9 / range.step) * range.step) % 32, 0);
  assert.equal(
    workflowFamilyStep({
      family: "custom",
      graph: { 1: { inputs: { unet_name: "unknown-model.safetensors" } } },
    }),
    0,
  );
  assert.deepEqual(sizedRange({ step: 8, min: 16 }, 0), { step: 8, min: 16 });
  // A Radiance node takes multiples of 32 where the family allows 16 (FLUX.3).
  const radiance = { family: "flux3", graph: { 1: { class_type: "RadianceImageGenerate" } } };
  assert.equal(workflowFamilyStep(radiance), 32);
});

test("imported workflows take their model family's native sizes, so chat can ask for 2K", () => {
  // The Bento FLUX.3 workflows declare a family the catalogue does not use; the model file names it.
  const flux3 = {
    family: "flux3_klein",
    graph: {
      1: {
        class_type: "UNETLoader",
        inputs: { unet_name: "flux3_image_klein_sd_int8_convrot.safetensors" },
      },
    },
  };
  assert.deepEqual(workflowFamilyValue(flux3, "native"), { "2k": "yes", "4k": "yes" });
  assert.equal(workflowFamilyValue({ family: "custom", graph: {} }, "native"), undefined);
});

test("Radiance image defaults, presets, inherited sizes and graph inputs use the 32-pixel grid", async () => {
  const workflow = "custom:radiance-size";
  const model = "flux-3-klein";
  const defaults = { width: 1040, height: 752 };
  const inputs = { ...defaults, model, cfg: 1, steps: 8, seed: 7, count: 1 };
  const controls = Object.fromEntries(
    ["model", "prompt", "width", "height"].map((input) => [input, { node: "1", input }]),
  );
  const graph = { 1: { class_type: "RadianceImageGenerate", inputs } };
  saveImportedWorkflow({
    studio: {
      id: "radiance-size",
      family: "flux3",
      controls,
      imageModes: { generate: { defaults } },
    },
    graph,
  });
  const info = {
    ...radianceInfo([{ id: model }]),
    EmptyLatentImage: {
      input: {
        required: { width: ["INT", { min: 16, step: 8 }], height: ["INT", { min: 16, step: 8 }] },
      },
    },
  };
  const profile = inferModels(info).profiles.find(({ id }) => id === workflow);
  assert.deepEqual([profile.defaults.width, profile.defaults.height], [1056, 768]);
  assert.deepEqual(profile.imageModes.generate.defaults.width, 1056);
  for (const { w, h } of profile.aspectPresets) {
    assert.equal(w % 32, 0);
    assert.equal(h % 32, 0);
  }
  const aspect = mcpSize(profile, { aspect: "13:6" });
  const tier = resolutionSize(aspect, "2K", profile);
  assert.equal(tier.width, 2048);
  assert.equal(tier.height % 32, 0);
  const input = { workflow, model: workflow, prompt: "A lighthouse", ...defaults };
  const body = sanitizeGenerateBody(input, info);
  assert.deepEqual([body.width, body.height], [1056, 768]);
  for (const available of [true, false]) {
    const routes = createGenerationSubmission({
      loadComfyContext: async () => ({ info }),
      mediaModels: async () => ({
        models: { profiles: [profile], workers: [{ id: "radiance", available }] },
      }),
    });
    const draft = { ...input, profileId: profile.id };
    assert.equal((await routes.validateInput(draft)).status, 200);
    assert.deepEqual([draft.width, draft.height], [1056, 768]);
  }
  for (const queued of [body, input, { ...input, width: undefined, height: undefined }]) {
    const built = await customWorkflowGraph(queued);
    assert.equal(imageRequest(built[1].inputs).body.size, "1056x768");
  }
  assert.throws(() => imageRequest({ ...inputs, prompt: input.prompt }), /multiples of 32/);
});

test("Radiance video sizes snap before sizing a first frame or planning latent upscale", async () => {
  const workflow = "custom:radiance-video-size";
  const model = "ltx-2.5-distilled";
  const inputs = { model, width: 1312, height: 752, frames: 121, seed: 7 };
  saveImportedWorkflow({
    studio: {
      id: "radiance-video-size",
      kind: "video",
      family: "ltx2",
      controls: Object.fromEntries(
        ["model", "prompt", "width", "height", "frames"].map((input) => [
          input,
          { node: "1", input },
        ]),
      ),
    },
    graph: { 1: { class_type: "RadianceVideoGenerate", inputs } },
  });
  const info = radianceInfo([{ id: model }]);
  const profile = inferModels(info).profiles.find(({ id }) => id === workflow);
  const size = frameSize(profile, 1411, 803);
  assert.equal(size.width % 32, 0);
  assert.equal(size.height % 32, 0);
  const body = sanitizeGenerateBody(
    {
      kind: "video",
      workflow,
      model: workflow,
      prompt: "Waves",
      width: 1318,
      height: 758,
    },
    info,
  );
  assert.deepEqual([body.width, body.height], [1312, 768]);
  const graph = await customWorkflowGraph(body);
  assert.equal(videoRequest(graph[1].inputs).body.size, "1280x768");
});
