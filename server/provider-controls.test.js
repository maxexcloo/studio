import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studio-provider-controls-"));
process.env.STUDIO_DATA_DIR = scratch;
const { saveCustomWorkflow } = await import("./custom-workflows.js");
const { inferModels } = await import("./models.js");
const { sanitizeGenerateBody } = await import("./validation.js");
const { customWorkflowGraph } = await import("./graphs.js");
const { generationSettings } = await import("./gallery-store.js");
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const info = {
  CLIPTextEncode: {},
  VAEDecode: {},
  SaveImage: {},
  KSampler: {},
  GrokMedia: {
    input: {
      required: {
        kind: [["image", "video"]],
        prompt: ["STRING"],
        width: ["INT", { default: 1024, min: 256, max: 2048, step: 8 }],
        height: ["INT", { default: 1024, min: 256, max: 2048, step: 8 }],
        seconds: ["INT", { default: 6, min: 1, max: 15, step: 1 }],
      },
      optional: {
        model: [["grok-imagine-image-2.0", "grok-imagine-video-1.5"]],
        resolution: [["", "1k", "2k", "480p", "720p", "1080p"]],
      },
    },
  },
};

for (const kind of ["image", "video"]) {
  const video = kind === "video";
  saveCustomWorkflow({
    heissUi: {
      id: `provider-${kind}`,
      kind,
      family: "grok",
      capabilities: { steps: false },
      controls: {
        model: { node: "1", input: "model" },
        prompt: { node: "1", input: "prompt" },
        resolution: { node: "1", input: "resolution" },
        ...(video ? { duration: { node: "1", input: "seconds" } } : {}),
      },
      options: { resolutions: video ? ["480p", "720p", "1080p"] : ["1k", "2k"] },
    },
    1: {
      class_type: "GrokMedia",
      inputs: {
        kind,
        model: video ? "grok-imagine-video-1.5" : "grok-imagine-image-2.0",
        prompt: "",
        width: 1024,
        height: 1024,
        seconds: 6,
        resolution: video ? "720p" : "1k",
      },
    },
  });
}

test("seconds and model-specific resolution travel from profile through validation, graph and saved output settings", async () => {
  const profiles = inferModels(info).profiles;
  for (const kind of ["image", "video"]) {
    const video = kind === "video";
    const profile = profiles.find((item) => item.id === `custom:provider-${kind}`);
    assert.ok(profile);
    assert.equal(profile.capabilities.steps, false);
    assert.equal(profile.capabilities.frames, false);
    assert.equal(profile.capabilities.fps, false);
    assert.equal(profile.capabilities.duration, video);
    assert.equal(profile.defaults.resolution, video ? "720p" : "1k");
    for (const resolution of profile.options.resolutions) {
      const body = sanitizeGenerateBody(
        {
          kind,
          workflow: profile.workflow,
          model: profile.model,
          prompt: "A lighthouse",
          duration: 12,
          resolution,
        },
        info,
      );
      const graph = await customWorkflowGraph(body);
      assert.equal(graph["1"].inputs.resolution, resolution);
      assert.equal(graph["1"].inputs.model, profile.baseModel);
      assert.equal(graph["1"].inputs.seconds, video ? 12 : 6);
      const settings = generationSettings(body);
      assert.equal(settings.resolution, resolution);
      if (video) {
        assert.equal(settings.duration, 12);
        assert.equal(settings.frames, undefined);
        assert.equal(settings.fps, undefined);
      }
    }
    const request = {
      kind,
      workflow: profile.workflow,
      model: profile.model,
      prompt: "A lighthouse",
    };
    assert.throws(
      () => sanitizeGenerateBody({ ...request, resolution: video ? "2k" : "1080p" }, info),
      /supported resolution/,
    );
    assert.equal(sanitizeGenerateBody(request, info).duration, video ? 6 : 0);
    assert.equal(
      sanitizeGenerateBody({ ...request, duration: 999 }, info).duration,
      video ? 15 : 0,
    );
  }
});
