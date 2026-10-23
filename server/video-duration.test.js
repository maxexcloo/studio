import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studio-video-duration-"));
process.env.STUDIO_DATA_DIR = scratch;
const { saveCustomWorkflow } = await import("./custom-workflows.js");
const { inferModels } = await import("./models.js");
const { sanitizeGenerateBody } = await import("./validation.js");
const { customWorkflowGraph } = await import("./graphs.js");
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const node = (inputs) => ({ input: { required: inputs } });
const info = {
  CLIPTextEncode: node({}),
  VAEDecode: node({}),
  SaveImage: node({}),
  LoadImage: node({ image: ["STRING"] }),
  MiniMaxH3ImageToVideo: node({
    prompt: ["STRING"],
    length: ["INT", { default: 124, min: 5, max: 3600, step: 17 }],
  }),
  CreateVideo: node({ fps: ["FLOAT", { default: 24, min: 1, max: 120 }] }),
  SaveVideo: node({}),
  KSampler: node({
    sampler_name: [["euler"]],
    scheduler: [["simple"]],
    steps: ["INT", { default: 8, min: 1, max: 10000 }],
  }),
};

test("custom H3 duration selections reach their mapped graph input with the fixed workflow FPS", async () => {
  for (const family of ["minimax-h3", "minimax_h3"]) {
    saveCustomWorkflow({
      heissUi: {
        id: "duration-h3",
        kind: "video",
        family,
        defaults: { fps: 24, steps: 8 },
        controls: {
          prompt: { node: "h3", input: "prompt" },
          frames: { node: "h3", input: "length" },
          steps: { node: "sampler", input: "steps" },
        },
      },
      h3: {
        class_type: "MiniMaxH3ImageToVideo",
        inputs: { prompt: "waves", length: 192, first_frame: ["frame", 0] },
      },
      frame: { class_type: "LoadImage", inputs: { image: "optional.png" } },
      sampler: { class_type: "KSampler", inputs: { steps: 8 } },
      video: { class_type: "CreateVideo", inputs: { images: ["h3", 0], fps: 24 } },
      save: { class_type: "SaveVideo", inputs: { video: ["video", 0], filename_prefix: "test" } },
    });
    const profile = inferModels(info).profiles.find((item) => item.id === "custom:duration-h3");
    assert.ok(profile);
    assert.equal(
      profile.defaults.frames,
      192,
      "the configured eight-second default survives H3 constraints",
    );
    assert.deepEqual(profile.constraints.frames, {
      default: 192,
      min: 124,
      max: 362,
      step: 17,
      offset: 5,
    });
    assert.notEqual(
      profile.constraints.steps.min,
      profile.constraints.steps.max,
      "a mapped sampler remains editable",
    );
    for (const frames of [124, 141, 192, 243, 362]) {
      const body = sanitizeGenerateBody(
        {
          kind: "video",
          workflow: profile.workflow,
          model: profile.model,
          prompt: "waves",
          frames,
          fps: 60,
          steps: 12,
        },
        info,
      );
      assert.equal(body.frames, frames);
      assert.equal(body.fps, 24);
      const graph = await customWorkflowGraph(body);
      assert.equal(graph.h3.inputs.length, frames);
      assert.equal(graph.video.inputs.fps, 24);
      assert.equal(graph.sampler.inputs.steps, 12);
      assert.equal(
        graph.h3.inputs.first_frame,
        undefined,
        "optional references follow node types rather than fixed IDs",
      );
    }
  }
});
