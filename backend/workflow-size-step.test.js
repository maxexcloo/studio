import assert from "node:assert/strict";
import test from "node:test";
const { sizedRange, workflowFamilyStep, workflowFamilyValue } = await import("./models.js");

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
