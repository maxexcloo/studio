// Two small profiles for tests that run generations: an SDXL image and a MiniMax H3 video on core
// ComfyUI nodes, each with its own checkpoint so a worker only runs what it lists. Written into a
// data folder's workflows/ before Studio reads it.
import fs from "node:fs";
import path from "node:path";

const controls = {
  prompt: { node: "2", input: "text" },
  negative: { node: "3", input: "text" },
  model: { node: "1", input: "ckpt_name" },
  width: { node: "4", input: "width" },
  height: { node: "4", input: "height" },
  seed: { node: "5", input: "seed" },
  steps: { node: "5", input: "steps" },
  cfg: { node: "5", input: "cfg" },
  sampler: { node: "5", input: "sampler_name" },
  scheduler: { node: "5", input: "scheduler" },
};
const graph = (checkpoint, latent) => ({
  1: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpoint } },
  2: { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["1", 1] } },
  3: { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["1", 1] } },
  4: latent,
  5: {
    class_type: "KSampler",
    inputs: {
      seed: 0,
      steps: 20,
      cfg: 7,
      sampler_name: "euler",
      scheduler: "normal",
      denoise: 1,
      model: ["1", 0],
      positive: ["2", 0],
      negative: ["3", 0],
      latent_image: ["4", 0],
    },
  },
  6: { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
});

export const testImageProfile = {
  studio: {
    id: "test-image",
    name: "Test Image",
    kind: "image",
    family: "sdxl",
    controls: { ...controls, count: { node: "4", input: "batch_size" } },
    defaults: { model: "sd_xl_base_1.0.safetensors", width: 1024, height: 1024 },
  },
  ...graph("sd_xl_base_1.0.safetensors", {
    class_type: "EmptyLatentImage",
    inputs: { width: 1024, height: 1024, batch_size: 1 },
  }),
  7: { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: "studio" } },
};

export const testVideoProfile = {
  studio: {
    id: "test-video",
    name: "Test Video",
    kind: "video",
    family: "minimax_h3",
    controls: { ...controls, frames: { node: "4", input: "length" } },
    defaults: { model: "minimax_h3_test.safetensors", width: 512, height: 288 },
  },
  ...graph("minimax_h3_test.safetensors", {
    class_type: "EmptyHunyuanLatentVideo",
    inputs: { width: 512, height: 288, length: 124, batch_size: 1 },
  }),
  7: { class_type: "CreateVideo", inputs: { images: ["6", 0], fps: 24 } },
  8: { class_type: "SaveVideo", inputs: { video: ["7", 0], filename_prefix: "studio" } },
};

export function writeTestWorkflows(dataDir) {
  const dir = path.join(dataDir, "workflows");
  fs.mkdirSync(dir, { recursive: true });
  for (const profile of [testImageProfile, testVideoProfile])
    fs.writeFileSync(path.join(dir, `${profile.studio.id}.json`), JSON.stringify(profile));
}
