import assert from "node:assert/strict";
import test from "node:test";

import { resolutionSize } from "../shared/resolution.ts";
import "./fixtures/sample-profiles.js";
import { frameSize } from "./animate-profile.js";
import { saveImportedWorkflow } from "./custom-workflows.js";
import { profileAspectSize } from "./generation-defaults.js";
import { createGenerationSubmission } from "./generation-routes.js";
import { customWorkflowGraph } from "./graphs.js";
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

for (const { model, family, step, size, maxWidth } of [
  {
    model: "flux-3-image-klein-base-iq8r-fast",
    family: "flux3_klein",
    step: 16,
    size: [1040, 752],
    maxWidth: 2048,
  },
  {
    model: "qwen-image-2.1-iq8r",
    family: "qwen_image_21",
    step: 32,
    size: [1056, 768],
    maxWidth: 1344,
  },
]) {
  test(`Radiance image defaults, presets and requests use the ${step}-pixel grid for ${model}`, async () => {
    const workflow = `custom:radiance-size-${step}`;
    const defaults = { cfg: 3.5, width: 1040, height: 752 };
    const inputs = { ...defaults, model, steps: 8, seed: 7, count: 1 };
    const controls = Object.fromEntries(
      ["cfg", "model", "prompt", "width", "height"].map((input) => [input, { node: "1", input }]),
    );
    const graph = { 1: { class_type: "RadianceImageGenerate", inputs } };
    saveImportedWorkflow({
      studio: {
        id: `radiance-size-${step}`,
        family,
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
    assert.deepEqual([profile.defaults.width, profile.defaults.height], size);
    assert.deepEqual(profile.imageModes.generate.defaults.width, size[0]);
    for (const { w, h } of profile.aspectPresets) {
      assert.equal(w % step, 0);
      assert.equal(h % step, 0);
    }
    const aspect = profileAspectSize(profile, { aspect: "13:6" });
    const tier = resolutionSize(aspect, "2K", profile);
    assert.equal(tier.width, maxWidth);
    assert.equal(tier.height % step, 0);
    const input = { workflow, model: workflow, prompt: "A lighthouse", ...defaults };
    const body = sanitizeGenerateBody(input, info);
    assert.deepEqual([body.width, body.height], size);
    assert.equal(body.cfg, 3.5);
    for (const available of [true, false]) {
      const routes = createGenerationSubmission({
        loadComfyContext: async () => ({ info }),
        mediaModels: async () => ({
          models: { profiles: [profile], workers: [{ id: "radiance", available }] },
        }),
      });
      const draft = { ...input, profileId: profile.id };
      assert.equal((await routes.validateInput(draft)).status, 200);
      assert.deepEqual([draft.width, draft.height], size);
    }
    for (const queued of [body, input, { ...input, width: undefined, height: undefined }]) {
      const built = await customWorkflowGraph(queued);
      const request = imageRequest(built[1].inputs).body;
      assert.equal(request.size, size.join("x"));
      assert.equal(request.guidance_scale, 3.5);
    }
    assert.throws(
      () => imageRequest({ ...inputs, width: 1041, prompt: input.prompt }),
      new RegExp(`multiples of ${step}`),
    );
  });
}

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
  assert.equal(profile.constraints.frames.max, 161);
  assert.equal(profile.constraints.frames.offset, 1);
  assert.equal(profile.constraints.fps.max, 24);
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

test("ComfyUI LTX profiles keep their workflow's frame and FPS ranges", () => {
  saveImportedWorkflow({
    studio: {
      id: "comfyui-ltx-video-ranges",
      kind: "video",
      family: "ltx2",
      controls: {
        frames: { node: "1", input: "length" },
        fps: { node: "2", input: "frame_rate" },
      },
    },
    graph: {
      1: { class_type: "EmptyLTXVLatentVideo", inputs: { length: 241 } },
      2: { class_type: "CreateVideo", inputs: { frame_rate: 30 } },
    },
  });
  const info = {
    EmptyLTXVLatentVideo: {
      input: { required: { length: ["INT", { min: 9, max: 481, step: 8 }] } },
    },
    CreateVideo: { input: { required: { frame_rate: ["FLOAT", { min: 1, max: 60, step: 1 }] } } },
  };
  const profile = inferModels(info, {}, { configuredOnly: true }).profiles.find(
    ({ id }) => id === "custom:comfyui-ltx-video-ranges",
  );
  assert.deepEqual(profile.constraints.frames, { default: 241, min: 9, max: 481, step: 8 });
  assert.deepEqual(profile.constraints.fps, { default: 30, min: 1, max: 60, step: 1 });
});
